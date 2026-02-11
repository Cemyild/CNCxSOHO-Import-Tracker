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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Maximum file size - 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Allowed file types (expanded to include Excel files)
const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

// Import document types
const IMPORT_DOCUMENT_TYPES = [
  { value: 'tax_calculation_spreadsheet', label: 'Tax Calculation Spreadsheet' },
  { value: 'advance_taxletter', label: 'Advance Taxletter' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'awb', label: 'AWB' },
  { value: 'import_declaration', label: 'Import Declaration' },
  { value: 'transit_declaration', label: 'Transit Declaration' },
  { value: 'pod', label: 'POD' },
  { value: 'expense_receipt', label: 'Expense Receipt' },
  { value: 'final_balance_letter', label: 'Final Balance Letter' },
  { value: 'bonded_warehouse_declaration', label: 'Bonded Warehouse Declaration' },
  { value: 'freight_invoice', label: 'Freight Invoice' }
];

interface ImportDocumentUploadProps {
  procedureReference: string;
  procedureId: number;
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
  documentType: string;
}

export function ImportDocumentUpload({ 
  procedureReference,
  procedureId,
  onUploadComplete
}: ImportDocumentUploadProps) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>('');
  const queryClient = useQueryClient();

  // Query to fetch existing import documents
  const { data: documentsData, isLoading } = useQuery({
    queryKey: ['/api/expense-documents/expense', 'import_document', procedureId],
    queryFn: () => 
      fetch(`/api/expense-documents/expense/import_document/${procedureId}`)
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch documents');
          }
          return response.json();
        }),
    enabled: !!procedureId,
  });

  // Mutation for uploading documents
  const uploadMutation = useMutation({
    mutationFn: async (file: DocumentFile) => {
      // Create FormData object for file upload
      const formData = new FormData();
      formData.append('file', file.file);
      formData.append('procedureReference', procedureReference);
      formData.append('expenseType', 'import_document');
      formData.append('expenseId', procedureId.toString());
      formData.append('importDocumentType', file.documentType);
      
      // Create a custom fetch request with FormData
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
      queryClient.invalidateQueries({ queryKey: ['/api/expense-documents/expense', 'import_document', procedureId] });
      queryClient.invalidateQueries({ queryKey: ['/api/expense-documents/procedure', procedureReference] });
      
      // Notify parent component
      if (onUploadComplete) {
        onUploadComplete(result.document);
      }
      
      // Show success toast
      toast({
        title: "Upload Complete",
        description: `${file.file.name} has been uploaded successfully`,
      });
    },
    onError: (error, file) => {
      console.error('Upload error:', error);
      
      // Update the file status to error
      setFiles(prev => 
        prev.map(f => 
          f.file === file.file 
            ? { ...f, status: 'error', progress: 0, error: error.message } 
            : f
        )
      );
      
      // Show error toast
      toast({
        title: "Upload Failed",
        description: `${file.file.name} could not be uploaded. ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // Mutation for deleting documents
  const deleteMutation = useMutation({
    mutationFn: (documentId: number) => 
      fetch(`/api/expense-documents/${documentId}`, {
        method: 'DELETE',
      }).then(response => {
        if (!response.ok) {
          throw new Error('Delete failed');
        }
        return response.json();
      }),
    onSuccess: () => {
      // Invalidate the documents query to refetch the list
      queryClient.invalidateQueries({ queryKey: ['/api/expense-documents/expense', 'import_document', procedureId] });
      queryClient.invalidateQueries({ queryKey: ['/api/expense-documents/procedure', procedureReference] });
      
      // Show success toast
      toast({
        title: "Delete Complete",
        description: "Document has been deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Delete error:', error);
      
      // Show error toast
      toast({
        title: "Delete Failed",
        description: `Document could not be deleted. ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // File drop handler
  const onDrop = (acceptedFiles: File[]) => {
    if (!selectedDocumentType) {
      toast({
        title: "Document Type Required",
        description: "Please select a document type before uploading files.",
        variant: "destructive",
      });
      return;
    }

    // Filter out files that are too large
    const validFiles = acceptedFiles.filter(file => file.size <= MAX_FILE_SIZE);
    const invalidFiles = acceptedFiles.filter(file => file.size > MAX_FILE_SIZE);
    
    // Show warning for files that are too large
    if (invalidFiles.length > 0) {
      toast({
        title: "Files Too Large",
        description: `${invalidFiles.length} file(s) exceed the maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB and will not be uploaded.`,
        variant: "destructive",
      });
    }
    
    // Add valid files to state
    if (validFiles.length > 0) {
      const newFiles = validFiles.map(file => ({
        file,
        progress: 0,
        status: 'pending' as FileStatus,
        documentType: selectedDocumentType,
        previewUrl: URL.createObjectURL(file),
      }));
      
      setFiles(prev => [...prev, ...newFiles]);
      
      // Start uploading each file
      newFiles.forEach(file => {
        uploadFile(file);
      });
    }
  };

  // DropZone configuration
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
  });
  
  // Upload a file
  const uploadFile = (file: DocumentFile) => {
    // Set file status to uploading
    setFiles(prev => 
      prev.map(f => 
        f.file === file.file 
          ? { ...f, status: 'uploading', progress: 10 } 
          : f
      )
    );
    
    // Simulate progress updates
    const progressInterval = setInterval(() => {
      setFiles(prev => {
        const updatedFiles = prev.map(f => {
          if (f.file === file.file && f.status === 'uploading' && f.progress < 90) {
            return { ...f, progress: f.progress + 10 };
          }
          return f;
        });
        return updatedFiles;
      });
    }, 300);
    
    // Start the upload
    uploadMutation.mutate(file, {
      onSettled: () => {
        clearInterval(progressInterval);
      }
    });
  };
  
  // Remove a file from the list
  const removeFile = (file: DocumentFile) => {
    setFiles(prev => prev.filter(f => f.file !== file.file));
    
    // Revoke object URL to avoid memory leaks
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
    }
  };
  
  // Get file icon based on MIME type
  const getFileIcon = (file: File) => {
    if (file.type.includes('pdf')) {
      return <FileText className="h-6 w-6 text-red-500" />;
    } else if (file.type.includes('image')) {
      return <FileImage className="h-6 w-6 text-blue-500" />;
    } else if (file.type.includes('excel') || file.type.includes('spreadsheet')) {
      return <FileText className="h-6 w-6 text-green-600" />;
    } else if (file.type.includes('word') || file.type.includes('document')) {
      return <FileText className="h-6 w-6 text-blue-700" />;
    } else {
      return <File className="h-6 w-6 text-gray-500" />;
    }
  };
  
  // Get document type label
  const getDocumentTypeLabel = (value: string) => {
    const docType = IMPORT_DOCUMENT_TYPES.find(type => type.value === value);
    return docType ? docType.label : value;
  };
  
  // Format file size
  const formatFileSize = (size: number) => {
    if (size < 1024) {
      return `${size} B`;
    } else if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    } else {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <Label htmlFor="document-type">Document Type</Label>
          <Select 
            value={selectedDocumentType} 
            onValueChange={setSelectedDocumentType}
          >
            <SelectTrigger id="document-type">
              <SelectValue placeholder="Select document type" />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary bg-primary/10' : 'border-border'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="h-10 w-10 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground text-center">
              {isDragActive
                ? "Drop the files here..."
                : "Drag & drop files here, or click to select files"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Accepted formats: PDF, JPG, PNG, DOC, DOCX, XLS, XLSX (Max {MAX_FILE_SIZE / (1024 * 1024)}MB)
            </p>
          </div>
        </div>
      </div>
      
      {/* File Upload List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Upload Queue</h4>
          {files.map((file, index) => (
            <div key={index} className="p-3 border rounded-md">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  {getFileIcon(file.file)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium truncate">{file.file.name}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatFileSize(file.file.size)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {getDocumentTypeLabel(file.documentType)}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeFile(file)}
                      disabled={file.status === 'uploading'}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {file.status === 'uploading' && (
                    <div className="mt-2">
                      <Progress value={file.progress} className="h-1" />
                      <span className="text-xs text-muted-foreground mt-1">
                        Uploading: {file.progress}%
                      </span>
                    </div>
                  )}
                  {file.status === 'error' && (
                    <p className="text-xs text-destructive mt-1">
                      {file.error || 'Upload failed'}
                    </p>
                  )}
                  {file.status === 'success' && (
                    <p className="text-xs text-green-600 mt-1">
                      Upload complete
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Existing Documents */}
      {documentsData?.documents && documentsData.documents.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Uploaded Documents</h4>
          <div className="grid grid-cols-1 gap-2">
            {documentsData.documents.map((doc: any) => (
              <div key={doc.id} className="p-3 border rounded-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {doc.fileType.includes('pdf') ? (
                        <FileText className="h-6 w-6 text-red-500" />
                      ) : doc.fileType.includes('image') ? (
                        <FileImage className="h-6 w-6 text-blue-500" />
                      ) : doc.fileType.includes('excel') || doc.fileType.includes('spreadsheet') ? (
                        <FileText className="h-6 w-6 text-green-600" />
                      ) : doc.fileType.includes('word') || doc.fileType.includes('document') ? (
                        <FileText className="h-6 w-6 text-blue-700" />
                      ) : (
                        <File className="h-6 w-6 text-gray-500" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium truncate">{doc.originalFilename}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatFileSize(doc.fileSize)}
                        </span>
                        {doc.importDocumentType && (
                          <Badge variant="outline" className="text-xs">
                            {getDocumentTypeLabel(doc.importDocumentType)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => deleteMutation.mutate(doc.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Delete document</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}