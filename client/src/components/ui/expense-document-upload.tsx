import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Trash2, Upload, FileText, FileImage, File, FileArchive, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

// Maximum file size - 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Allowed file types
const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

interface ExpenseDocumentUploadProps {
  procedureReference: string;
  expenseType: 'tax' | 'import_expense' | 'service_invoice';
  expenseId: number;
  onUploadComplete?: (document: any) => void;
}

// Define the allowed status types
type FileStatus = 'pending' | 'uploading' | 'success' | 'error';

interface DocumentFile {
  file: File;
  id?: number;
  progress: number;
  status: FileStatus;
  previewUrl?: string;
  error?: string;
}

export function ExpenseDocumentUpload({ 
  procedureReference, 
  expenseType, 
  expenseId,
  onUploadComplete
}: ExpenseDocumentUploadProps) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const queryClient = useQueryClient();

  // Query to fetch existing documents
  const { data: documentsData, isLoading } = useQuery({
    queryKey: ['/api/expense-documents/expense', expenseType, expenseId],
    queryFn: () => 
      fetch(`/api/expense-documents/expense/${expenseType}/${expenseId}`)
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch documents');
          }
          return response.json();
        }),
    enabled: !!expenseId,
  });

  // Mutation for uploading documents
  const uploadMutation = useMutation({
    mutationFn: async (file: DocumentFile) => {
      // Create FormData object for file upload
      const formData = new FormData();
      formData.append('file', file.file);
      formData.append('procedureReference', procedureReference);
      formData.append('expenseType', expenseType);
      formData.append('expenseId', expenseId.toString());
      
      // Create a custom axios request with FormData
      return fetch('/api/expense-documents', {
        method: 'POST',
        body: formData,
      }).then(response => {
        if (!response.ok) {
          throw new Error('Upload failed');
        }
        return response.json();
      });
    },
    onSuccess: (result, file) => {
      // Update the file status
      setFiles(prev => 
        prev.map(f => 
          f.file === file.file 
            ? { ...f, status: 'success', id: result.document.id, progress: 100 } 
            : f
        )
      );
      
      // Invalidate the documents query to refetch the list
      queryClient.invalidateQueries({ queryKey: ['/api/expense-documents/expense', expenseType, expenseId] });
      
      toast({
        title: 'Document uploaded',
        description: `${file.file.name} has been uploaded successfully.`,
      });
      
      if (onUploadComplete) {
        onUploadComplete(result.document);
      }
    },
    onError: (error, file) => {
      console.error('Upload error:', error);
      setFiles(prev => 
        prev.map(f => 
          f.file === file.file 
            ? { ...f, status: 'error', progress: 0, error: 'Upload failed' } 
            : f
        )
      );
      
      toast({
        title: 'Upload failed',
        description: `Failed to upload ${file.file.name}. Please try again.`,
        variant: 'destructive',
      });
    }
  });

  // Mutation for deleting documents
  const deleteMutation = useMutation({
    mutationFn: (documentId: number) => {
      return fetch(`/api/expense-documents/${documentId}`, {
        method: 'DELETE',
      }).then(response => {
        if (!response.ok) {
          throw new Error('Delete failed');
        }
        return response.json();
      });
    },
    onSuccess: (_, documentId) => {
      // Remove the file from the state
      setFiles(prev => prev.filter(f => f.id !== documentId));
      
      // Invalidate the documents query to refetch the list
      queryClient.invalidateQueries({ queryKey: ['/api/expense-documents/expense', expenseType, expenseId] });
      
      toast({
        title: 'Document deleted',
        description: 'The document has been deleted successfully.',
      });
    },
    onError: (error) => {
      console.error('Delete error:', error);
      
      toast({
        title: 'Delete failed',
        description: 'Failed to delete the document. Please try again.',
        variant: 'destructive',
      });
    }
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPTED_FILE_TYPES as any,
    maxSize: MAX_FILE_SIZE,
    onDrop: (acceptedFiles) => {
      // Create preview URLs for images
      const newFiles = acceptedFiles.map(file => {
        const isImage = file.type.startsWith('image/');
        return {
          file,
          progress: 0,
          status: 'pending' as const,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        };
      });
      
      setFiles(prev => [...prev, ...newFiles]);
    },
    onDropRejected: (rejectedFiles) => {
      rejectedFiles.forEach(rejection => {
        const { file, errors } = rejection;
        
        if (errors.some(e => e.code === 'file-too-large')) {
          toast({
            title: 'File too large',
            description: `${file.name} is larger than 5MB.`,
            variant: 'destructive',
          });
        } else if (errors.some(e => e.code === 'file-invalid-type')) {
          toast({
            title: 'Invalid file type',
            description: `${file.name} is not a supported file type.`,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Invalid file',
            description: `${file.name} could not be uploaded.`,
            variant: 'destructive',
          });
        }
      });
    }
  });

  const handleUpload = async (file: DocumentFile) => {
    // Update file status to uploading
    setFiles(prev => 
      prev.map(f => 
        f.file === file.file 
          ? { ...f, status: 'uploading', progress: 10 } 
          : f
      )
    );
    
    // Simulate upload progress
    const timer = setInterval(() => {
      setFiles(prev => {
        const updated = prev.map(f => {
          if (f.file === file.file && f.status === 'uploading' && f.progress < 90) {
            return { ...f, progress: f.progress + 10 };
          }
          return f;
        });
        return updated;
      });
    }, 300);
    
    // Start the actual upload
    uploadMutation.mutate(file);
    
    // Clear the interval after 2 seconds
    setTimeout(() => clearInterval(timer), 2000);
  };

  const handleDelete = (file: DocumentFile) => {
    if (file.id) {
      // If the file has an ID, it's already uploaded, so delete it from the server
      deleteMutation.mutate(file.id);
    } else {
      // If the file doesn't have an ID, it's not uploaded yet, just remove it from the state
      setFiles(prev => prev.filter(f => f.file !== file.file));
    }
  };

  // Function to get the appropriate icon based on file type
  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) {
      return <FileImage className="h-6 w-6" />;
    } else if (fileType === 'application/pdf') {
      return <FileText className="h-6 w-6" />;
    } else if (fileType.includes('document') || fileType.includes('word')) {
      return <FileText className="h-6 w-6" />;
    } else if (fileType.includes('zip') || fileType.includes('compressed')) {
      return <FileArchive className="h-6 w-6" />;
    } else {
      return <File className="h-6 w-6" />;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Document Upload</CardTitle>
        <CardDescription>
          Upload supporting documents for this expense. Supported formats: PDF, JPG, PNG, DOC, DOCX. Max size: 5MB per file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div 
          {...getRootProps()} 
          className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors
            ${isDragActive ? 'border-primary bg-primary/10' : 'border-gray-300 hover:border-primary/50 hover:bg-gray-50'}`}
        >
          <input {...getInputProps()} />
          <Upload className="h-10 w-10 text-gray-400 mb-2" />
          <p className="text-sm font-medium mb-1">
            {isDragActive ? 'Drop files here...' : 'Drag and drop files, or click to select'}
          </p>
          <p className="text-xs text-gray-500">
            PDF, JPG, PNG, DOC, DOCX up to 5MB
          </p>
        </div>

        {files.length > 0 && (
          <div className="mt-6 space-y-4">
            <h4 className="text-sm font-medium">Selected Files</h4>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div key={`${file.file.name}-${index}`} className="flex items-center p-3 border rounded-md">
                  <div className="flex items-center flex-1 min-w-0">
                    <div className="flex-shrink-0 mr-3 text-gray-500">
                      {getFileIcon(file.file.type)}
                    </div>
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-sm font-medium truncate">{file.file.name}</p>
                      <p className="text-xs text-gray-500">{Math.round(file.file.size / 1024)} KB</p>
                    </div>
                  </div>
                  
                  {file.status === 'error' && (
                    <Badge variant="destructive" className="mr-2">Failed</Badge>
                  )}
                  
                  {file.status === 'success' && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 mr-2">Uploaded</Badge>
                  )}
                  
                  {(file.status === 'pending' || file.status === 'uploading') && (
                    <div className="flex-shrink-0 flex items-center space-x-2 mr-2">
                      {file.status === 'pending' ? (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => handleUpload(file)}
                          disabled={file.status === 'uploading' as FileStatus}
                        >
                          Upload
                        </Button>
                      ) : (
                        <div className="w-20">
                          <Progress value={file.progress} className="h-2" />
                        </div>
                      )}
                    </div>
                  )}
                  
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDelete(file)}
                          disabled={file.status === 'uploading' as FileStatus}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete file</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ))}
            </div>
          </div>
        )}

        {documentsData?.documents && documentsData.documents.length > 0 && (
          <div className="mt-6 space-y-4">
            <h4 className="text-sm font-medium">Uploaded Documents</h4>
            <div className="space-y-2">
              {documentsData.documents.map((doc: any) => (
                <div key={doc.id} className="flex items-center p-3 border rounded-md">
                  <div className="flex items-center flex-1 min-w-0">
                    <div className="flex-shrink-0 mr-3 text-gray-500">
                      {getFileIcon(doc.fileType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.originalFilename}</p>
                      <p className="text-xs text-gray-500">
                        {Math.round(doc.fileSize / 1024)} KB • Uploaded on {new Date(doc.uploadDate).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => deleteMutation.mutate(doc.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete document</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}