import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, Loader2, Image as ImageIcon, FileWarning } from 'lucide-react';
import { FloorPlanProcessor } from './floorPlanProcessor.js';

export default function LabUpload({ onUpload }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG).');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const processor = new FloorPlanProcessor();
      const result = await processor.processImage(file);

      // Artificial delay for UX
      await new Promise(resolve => setTimeout(resolve, 800));

      if (result && result.walls && result.walls.length > 0) {
        onUpload(result);
      } else {
        throw new Error('No walls detected. Please try a clearer image.');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to process floor plan.');
    } finally {
      setIsLoading(false);
    }
  }, [onUpload]);

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  return React.createElement('div', { className: 'w-full max-w-xl mx-auto' },
    React.createElement('div', {
      className: `relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${isDragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-white dark:bg-gray-800'}`,
      onDragOver: onDragOver,
      onDragLeave: onDragLeave,
      onDrop: onDrop
    },
      isLoading ? React.createElement('div', { className: 'flex flex-col items-center py-8' },
        React.createElement(Loader2, { className: 'w-10 h-10 text-indigo-500 animate-spin mb-4' }),
        React.createElement('p', { className: 'text-gray-600 dark:text-gray-300 font-medium' }, 'Analyzing Floor Plan...'),
        React.createElement('p', { className: 'text-sm text-gray-400 mt-2' }, 'Detecting walls and generating geometry')
      ) : React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'flex justify-center mb-4' },
          React.createElement('div', { className: 'p-3 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' },
            React.createElement(Upload, { className: 'w-8 h-8' })
          )
        ),
        React.createElement('h3', { className: 'text-lg font-bold text-gray-900 dark:text-white mb-2' }, 'Upload Floor Plan'),
        React.createElement('p', { className: 'text-gray-500 dark:text-gray-400 mb-6 text-sm' },
          'Drag and drop your image here, or'
        ),
        React.createElement('input', {
          type: 'file',
          ref: fileInputRef,
          className: 'hidden',
          accept: 'image/*',
          onChange: (e) => e.target.files?.[0] && processFile(e.target.files[0])
        }),
        React.createElement('button', {
          onClick: () => fileInputRef.current?.click(),
          className: 'px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors text-sm shadow-sm'
        }, 'Select File')
      ),
      error && React.createElement('div', { className: 'mt-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3' },
        React.createElement(FileWarning, { className: 'w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5' }),
        React.createElement('p', { className: 'text-sm text-red-600 dark:text-red-300' }, error)
      )
    )
  );
}