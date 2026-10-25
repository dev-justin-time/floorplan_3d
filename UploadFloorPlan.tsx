"use client";
import { jsxDEV } from "react/jsx-dev-runtime";
import { useState, useRef } from "react";
import { processFloorPlan } from "./floorPlanProcessor.ts";
function Upload({ onUpload }) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [processingStatus, setProcessingStatus] = useState("");
  const fileInputRef = useRef(null);
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };
  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  };
  const handleFile = (file2) => {
    if (!file2.type.match("image.*")) {
      setError("Please upload an image file");
      return;
    }
    setFile(file2);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setPreview(e.target.result);
      }
    };
    reader.readAsDataURL(file2);
  };
  const handleUpload = async () => {
    if (!file || !preview) {
      setError("Please select a file first");
      return;
    }
    setIsLoading(true);
    setProcessingStatus("Analyzing floor plan...");
    try {
      setProcessingStatus("Detecting walls and rooms...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      setProcessingStatus("Calculating dimensions...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      setProcessingStatus("Generating 3D model data...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const floorPlanData = await processFloorPlan(preview);
      onUpload(floorPlanData);
    } catch (err) {
      setError("Error processing floor plan: " + (err instanceof Error ? err.message : String(err)));
      console.error(err);
    } finally {
      setIsLoading(false);
      setProcessingStatus("");
    }
  };
  return /* @__PURE__ */ jsxDEV("div", { className: "w-full max-w-2xl mx-auto p-6", children: [
    /* @__PURE__ */ jsxDEV(
      "div",
      {
        className: `border-2 border-dashed rounded-lg p-8 text-center ${isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300"}`,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
        children: [
          preview ? /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
            /* @__PURE__ */ jsxDEV(
              "img",
              {
                src: preview,
                alt: "Floor plan preview",
                className: "max-h-64 mx-auto"
              },
              void 0,
              false,
              {
                fileName: "<stdin>",
                lineNumber: 108,
                columnNumber: 13
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                className: "text-sm text-red-500",
                onClick: () => {
                  setFile(null);
                  setPreview(null);
                },
                children: "Remove"
              },
              void 0,
              false,
              {
                fileName: "<stdin>",
                lineNumber: 113,
                columnNumber: 13
              },
              this
            )
          ] }, void 0, true, {
            fileName: "<stdin>",
            lineNumber: 107,
            columnNumber: 11
          }, this) : /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
            /* @__PURE__ */ jsxDEV("div", { className: "text-gray-500", children: /* @__PURE__ */ jsxDEV(
              "svg",
              {
                className: "mx-auto h-12 w-12",
                fill: "none",
                stroke: "currentColor",
                viewBox: "0 0 24 24",
                xmlns: "http://www.w3.org/2000/svg",
                children: /* @__PURE__ */ jsxDEV(
                  "path",
                  {
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    strokeWidth: 2,
                    d: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  },
                  void 0,
                  false,
                  {
                    fileName: "<stdin>",
                    lineNumber: 133,
                    columnNumber: 17
                  },
                  this
                )
              },
              void 0,
              false,
              {
                fileName: "<stdin>",
                lineNumber: 126,
                columnNumber: 15
              },
              this
            ) }, void 0, false, {
              fileName: "<stdin>",
              lineNumber: 125,
              columnNumber: 13
            }, this),
            /* @__PURE__ */ jsxDEV("div", { className: "text-sm text-gray-600", children: [
              /* @__PURE__ */ jsxDEV("p", { children: "Drag and drop your floor plan image here, or" }, void 0, false, {
                fileName: "<stdin>",
                lineNumber: 142,
                columnNumber: 15
              }, this),
              /* @__PURE__ */ jsxDEV(
                "button",
                {
                  type: "button",
                  className: "text-blue-500 hover:text-blue-700 font-medium",
                  onClick: () => fileInputRef.current?.click(),
                  children: "browse files"
                },
                void 0,
                false,
                {
                  fileName: "<stdin>",
                  lineNumber: 143,
                  columnNumber: 15
                },
                this
              )
            ] }, void 0, true, {
              fileName: "<stdin>",
              lineNumber: 141,
              columnNumber: 13
            }, this),
            /* @__PURE__ */ jsxDEV("div", { className: "text-xs text-gray-400", children: "Supported formats: JPG, PNG, SVG" }, void 0, false, {
              fileName: "<stdin>",
              lineNumber: 151,
              columnNumber: 13
            }, this)
          ] }, void 0, true, {
            fileName: "<stdin>",
            lineNumber: 124,
            columnNumber: 11
          }, this),
          /* @__PURE__ */ jsxDEV(
            "input",
            {
              type: "file",
              ref: fileInputRef,
              onChange: handleFileInput,
              className: "hidden",
              accept: "image/*"
            },
            void 0,
            false,
            {
              fileName: "<stdin>",
              lineNumber: 156,
              columnNumber: 9
            },
            this
          )
        ]
      },
      void 0,
      true,
      {
        fileName: "<stdin>",
        lineNumber: 98,
        columnNumber: 7
      },
      this
    ),
    error && /* @__PURE__ */ jsxDEV("div", { className: "mt-4 text-red-500 text-sm", children: error }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 166,
      columnNumber: 9
    }, this),
    isLoading && /* @__PURE__ */ jsxDEV("div", { className: "mt-4", children: [
      /* @__PURE__ */ jsxDEV("div", { className: "w-full bg-gray-200 rounded-full h-2.5", children: /* @__PURE__ */ jsxDEV("div", { className: "bg-blue-600 h-2.5 rounded-full animate-pulse w-full" }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 174,
        columnNumber: 13
      }, this) }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 173,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("p", { className: "text-sm text-gray-600 mt-2", children: processingStatus }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 176,
        columnNumber: 11
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 172,
      columnNumber: 9
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "mt-6", children: /* @__PURE__ */ jsxDEV(
      "button",
      {
        className: `w-full py-2 px-4 rounded-md ${file && !isLoading ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-300 text-gray-500 cursor-not-allowed"}`,
        disabled: !file || isLoading,
        onClick: handleUpload,
        children: isLoading ? "Processing..." : "Generate 3D Model"
      },
      void 0,
      false,
      {
        fileName: "<stdin>",
        lineNumber: 181,
        columnNumber: 9
      },
      this
    ) }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 180,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "mt-6 text-sm text-gray-500", children: [
      /* @__PURE__ */ jsxDEV("h3", { className: "font-medium text-gray-700 mb-2", children: "Tips for best results:" }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 195,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("ul", { className: "list-disc pl-5 space-y-1", children: [
        /* @__PURE__ */ jsxDEV("li", { children: "Use clear, high-contrast floor plan images" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 197,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("li", { children: "Ensure walls are clearly visible" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 198,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("li", { children: "Images should be properly oriented (north up)" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 199,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("li", { children: "Floor plans with labeled rooms work best" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 200,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 196,
        columnNumber: 9
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 194,
      columnNumber: 7
    }, this)
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 97,
    columnNumber: 5
  }, this);
}
export {
  Upload as default
};
