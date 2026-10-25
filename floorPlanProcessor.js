export class FloorPlanProcessor {
    constructor() {
        this.canvas = document.createElement('canvas');
        // willReadFrequently optimizes canvas readback performance in modern browsers
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.params = {
            gaussianRadius: 1,      // Noise reduction
            cannyLow: 40,           // Weak edge threshold
            cannyHigh: 120,         // Strong edge threshold
            minWallLength: 30,      // Minimum wall length in pixels
            rdpTolerance: 4,        // Corner detection sensitivity (pixels)
            orthoTolerance: 15      // Degrees to snap to 0/90/180/270
        };
    }

    async processImage(file) {
        const image = await this.loadImage(file);
        this.canvas.width = image.width;
        this.canvas.height = image.height;
        this.ctx.drawImage(image, 0, 0);

        const { width, height } = this.canvas;
        const imageData = this.ctx.getImageData(0, 0, width, height);
        
        // 1. Preprocess: Grayscale + Gaussian Blur
        const gray = this.grayscaleAndBlur(imageData.data, width, height);
        
        // 2. Edge Detection: Canny (Sobel + NMS + Hysteresis)
        const edges = this.cannyEdgeDetection(gray, width, height);
        
        // 3. Contour Tracing: Moore-Neighbor algorithm for ordered boundaries
        const contours = this.traceContours(edges, width, height);
        
        // 4. Vectorization: Simplify and extract orthogonal wall segments
        const walls = this.extractWalls(contours, width, height);

        return {
            width,
            height,
            walls,
            debugImage: this.renderDebug(edges, contours, walls) // Optional: for UI preview
        };
    }

    loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            const reader = new FileReader();
            reader.onload = e => img.src = e.target.result;
            reader.readAsDataURL(file);
        });
    }

    // --- 1. Preprocessing ---
    grayscaleAndBlur(data, width, height) {
        const gray = new Uint8Array(width * height);
        const blurred = new Uint8Array(width * height);
        const r = this.params.gaussianRadius;

        for (let i = 0; i < data.length; i += 4) {
            // Luminance formula is more accurate than simple average
            gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        // 3x3 Box Blur (faster than Gaussian, sufficient for this use case)
        for (let y = r; y < height - r; y++) {
            for (let x = r; x < width - r; x++) {
                let sum = 0;
                for (let ky = -r; ky <= r; ky++) {
                    for (let kx = -r; kx <= r; kx++) {
                        sum += gray[(y + ky) * width + (x + kx)];
                    }
                }
                blurred[y * width + x] = sum / 9;
            }
        }
        return blurred;
    }

    // --- 2. Canny Edge Detection ---
    cannyEdgeDetection(gray, width, height) {
        const magnitude = new Float32Array(width * height);
        const direction = new Uint8Array(width * height);
        const edges = new Uint8Array(width * height);

        // Sobel Operator
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const gx = -gray[idx - width - 1] + gray[idx - width + 1] 
                         - 2 * gray[idx - 1] + 2 * gray[idx + 1] 
                         - gray[idx + width - 1] + gray[idx + width + 1];
                const gy = -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1] 
                         + gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
                
                magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
                // Quantize direction to 0, 45, 90, 135 degrees
                let angle = Math.atan2(gy, gx) * (180 / Math.PI);
                if (angle < 0) angle += 180;
                direction[idx] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 1 : angle < 112.5 ? 2 : 3;
            }
        }

        // Non-Maximum Suppression (Thin edges to 1px)
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                let nms = 0;
                const mag = magnitude[idx];
                const dir = direction[idx];

                if (dir === 0) nms = Math.max(magnitude[idx - 1], magnitude[idx + 1]);
                else if (dir === 1) nms = Math.max(magnitude[idx - width - 1], magnitude[idx + width + 1]);
                else if (dir === 2) nms = Math.max(magnitude[idx - width], magnitude[idx + width]);
                else nms = Math.max(magnitude[idx - width + 1], magnitude[idx + width - 1]);

                if (mag >= nms) edges[idx] = mag > this.params.cannyHigh ? 255 : (mag > this.params.cannyLow ? 128 : 0);
            }
        }

        // Hysteresis Thresholding
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (edges[idx] === 255) {
                    // Keep strong edges, and promote weak edges connected to strong ones
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            if (edges[(y + ky) * width + (x + kx)] === 255) {
                                edges[idx] = 255; break;
                            }
                        }
                    }
                } else {
                    edges[idx] = 0; // Suppress unconnected weak edges
                }
            }
        }
        return edges;
    }

    // --- 3. Contour Tracing (Moore-Neighbor) ---
    traceContours(edges, width, height) {
        const contours = [];
        const visited = new Uint8Array(width * height);
        const directions = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (edges[idx] === 255 && !visited[idx]) {
                    const contour = [];
                    let cx = x, cy = y, dirIdx = 0;

                    while (true) {
                        contour.push([cx, cy]);
                        visited[cy * width + cx] = 1;
                        edges[cy * width + cx] = 0; // Consume edge to prevent re-tracing

                        let found = false;
                        for (let i = 0; i < 8; i++) {
                            const checkIdx = (dirIdx + i) % 8;
                            const nx = cx + directions[checkIdx][0];
                            const ny = cy + directions[checkIdx][1];
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height && edges[ny * width + nx] === 255) {
                                cx = nx; cy = ny;
                                dirIdx = (checkIdx + 5) % 8; // Backtrack for next search
                                found = true;
                                break;
                            }
                        }
                        // Stop if we closed the loop or hit a dead end
                        if (!found || (cx === x && cy === y && contour.length > 5)) break;
                    }
                    if (contour.length > 10) contours.push(contour);
                }
            }
        }
        return contours;
    }

    // --- 4. Vectorization & Wall Extraction ---
    extractWalls(contours, width, height) {
        const walls = [];
        const tolerance = this.params.rdpTolerance;

        for (const contour of contours) {
            // Ramer-Douglas-Peucker simplification
            const simplified = this.rdpSimplify(contour, tolerance);
            
            // Convert vertices to line segments
            for (let i = 0; i < simplified.length - 1; i++) {
                const p1 = simplified[i];
                const p2 = simplified[i + 1];
                const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);

                if (length >= this.params.minWallLength) {
                    let angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * (180 / Math.PI);
                    if (angle < 0) angle += 360;

                    // Orthogonal Snapping: Force walls to be 0, 90, 180, or 270 degrees
                    const snapAngles = [0, 90, 180, 270, 360];
                    const closest = snapAngles.reduce((prev, curr) => 
                        Math.abs(curr - angle) < Math.abs(prev - angle) ? curr : prev
                    );

                    if (Math.abs(closest - angle) <= this.params.orthoTolerance || Math.abs(closest - 360 - angle) <= this.params.orthoTolerance) {
                        // Recalculate endpoint based on snapped angle and original length
                        const rad = (closest === 360 ? 0 : closest) * (Math.PI / 180);
                        const newX = p1[0] + length * Math.cos(rad);
                        const newY = p1[1] + length * Math.sin(rad);

                        walls.push({
                            start: { x: p1[0], y: p1[1] },
                            end: { x: newX, y: newY },
                            length: length,
                            angle: closest === 360 ? 0 : closest
                        });
                    }
                }
            }
        }

        // Merge collinear/overlapping wall segments for cleaner output
        return this.mergeCollinearWalls(walls);
    }

    rdpSimplify(points, tolerance) {
        if (points.length <= 2) return points;
        let maxDist = 0, maxIdx = 0;
        const start = points[0], end = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this.perpendicularDistance(points[i], start, end);
            if (dist > maxDist) { maxDist = dist; maxIdx = i; }
        }

        if (maxDist > tolerance) {
            const left = this.rdpSimplify(points.slice(0, maxIdx + 1), tolerance);
            const right = this.rdpSimplify(points.slice(maxIdx), tolerance);
            return [...left.slice(0, -1), ...right];
        }
        return [start, end];
    }

    perpendicularDistance(point, start, end) {
        const [x, y] = point;
        const [x1, y1] = start;
        const [x2, y2] = end;
        if (x1 === x2 && y1 === y2) return Math.hypot(x - x1, y - y1);

        const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
        const param = Math.max(0, Math.min(1, (A * C + B * D) / (C * C + D * D)));
        return Math.hypot(x - (x1 + param * C), y - (y1 + param * D));
    }

    mergeCollinearWalls(walls) {
        const merged = [];
        const used = new Uint8Array(walls.length);
        const mergeThreshold = 15; // Pixels

        for (let i = 0; i < walls.length; i++) {
            if (used[i]) continue;
            let current = { ...walls[i] };
            used[i] = 1;

            let changed = true;
            while (changed) {
                changed = false;
                for (let j = i + 1; j < walls.length; j++) {
                    if (used[j]) continue;
                    const w2 = walls[j];
                    
                    // Check if same angle and close proximity
                    if (Math.abs(current.angle - w2.angle) < 5) {
                        const distStart = Math.hypot(current.start.x - w2.start.x, current.start.y - w2.start.y);
                        const distEnd = Math.hypot(current.end.x - w2.end.x, current.end.y - w2.end.y);
                        const distCross1 = Math.hypot(current.start.x - w2.end.x, current.start.y - w2.end.y);
                        const distCross2 = Math.hypot(current.end.x - w2.start.x, current.end.y - w2.start.y);

                        if (distEnd < mergeThreshold) {
                            current.end = w2.end; current.length = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
                            used[j] = 1; changed = true;
                        } else if (distStart < mergeThreshold) {
                            current.start = w2.start; current.length = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
                            used[j] = 1; changed = true;
                        } else if (distCross1 < mergeThreshold) {
                            current.start = w2.end; current.length = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
                            used[j] = 1; changed = true;
                        } else if (distCross2 < mergeThreshold) {
                            current.end = w2.start; current.length = Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y);
                            used[j] = 1; changed = true;
                        }
                    }
                }
            }
            merged.push(current);
        }
        return merged;
    }

    // Optional: Generates a canvas overlay for debugging/UI preview
    renderDebug(edgeData, contours, walls) {
        const debugCanvas = document.createElement('canvas');
        debugCanvas.width = this.canvas.width;
        debugCanvas.height = this.canvas.height;
        const ctx = debugCanvas.getContext('2d');
        
        // Draw original faded
        ctx.globalAlpha = 0.3;
        ctx.drawImage(this.canvas, 0, 0);
        ctx.globalAlpha = 1.0;

        // Draw detected walls
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const wall of walls) {
            ctx.moveTo(wall.start.x, wall.start.y);
            ctx.lineTo(wall.end.x, wall.end.y);
        }
        ctx.stroke();

        // Draw corners
        ctx.fillStyle = '#ff0055';
        for (const wall of walls) {
            ctx.beginPath();
            ctx.arc(wall.start.x, wall.start.y, 4, 0, Math.PI * 2);
            ctx.arc(wall.end.x, wall.end.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        return debugCanvas.toDataURL();
    }
}