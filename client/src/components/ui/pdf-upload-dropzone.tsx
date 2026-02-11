import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Loader2, Upload, FileText, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PdfUploadDropzoneProps {
  title: string;
  onFileSelect: (file: File) => Promise<void>;
  isAnalyzing: boolean;
  error?: string | null;
  maxSizeMB?: number;
}

export function PdfUploadDropzone({
  title,
  onFileSelect,
  isAnalyzing,
  error,
  maxSizeMB = 20
}: PdfUploadDropzoneProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: any[]) => {
    setLocalError(null);
    
    if (rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      if (rejection.errors[0]?.code === 'file-too-large') {
        setLocalError(`PDF file must be under ${maxSizeMB}MB`);
      } else if (rejection.errors[0]?.code === 'file-invalid-type') {
        setLocalError('Please upload a PDF file');
      } else {
        setLocalError('Invalid file');
      }
      return;
    }

    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFile(file);
      
      try {
        await onFileSelect(file);
        // Clear file after successful upload
        setTimeout(() => setSelectedFile(null), 2000);
      } catch (err) {
        setSelectedFile(null);
      }
    }
  }, [onFileSelect, maxSizeMB]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
    },
    maxSize: maxSizeMB * 1024 * 1024, // Convert MB to bytes
    multiple: false,
    disabled: isAnalyzing
  });

  const displayError = error || localError;

  return (
    <Card className="mb-6 border-dashed border-2 border-blue-200 bg-blue-50/50">
      <CardContent className="p-6">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {title}
        </h3>
        
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer
            ${isDragActive ? 'border-blue-500 bg-blue-100' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
            ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          data-testid="pdf-dropzone"
        >
          <input {...getInputProps()} data-testid="pdf-input" />
          
          {isAnalyzing ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
              <p className="text-sm text-gray-600">Analyzing document...</p>
              <p className="text-xs text-gray-500">This may take a few moments</p>
            </div>
          ) : selectedFile ? (
            <div className="flex flex-col items-center gap-2">
              <FileText className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium text-green-700">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          ) : isDragActive ? (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-10 w-10 text-blue-500" />
              <p className="text-sm text-blue-600 font-medium">Drop PDF here</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-10 w-10 text-gray-400" />
              <p className="text-sm text-gray-600">
                <span className="font-medium text-blue-600 hover:text-blue-700">Click to browse</span>
                {' '}or drag PDF here
              </p>
              <p className="text-xs text-gray-500">
                Maximum file size: {maxSizeMB}MB
              </p>
            </div>
          )}
        </div>

        {displayError && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription data-testid="pdf-error">{displayError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
