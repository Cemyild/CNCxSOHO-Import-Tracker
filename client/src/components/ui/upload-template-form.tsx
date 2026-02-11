import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function UploadTemplateForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    
    // Reset states
    setSuccess(false);
    setError(null);
    
    // Check if file is selected
    if (!selectedFile) {
      setFile(null);
      return;
    }
    
    // Check if it's a DOCX file
    if (selectedFile.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      setError('Please select a valid Word document (.docx) file');
      setFile(null);
      return;
    }
    
    setFile(selectedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a template file');
      return;
    }
    
    setUploading(true);
    setError(null);
    
    try {
      console.log('Uploading file:', file.name, file.type, file.size);
      
      const formData = new FormData();
      formData.append('template', file);
      
      // Log FormData content (for debugging)
      console.log('FormData has file:', formData.has('template'));
      
      const response = await fetch('/api/pdf/upload-template', {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header - the browser will set it with the boundary
      });
      
      console.log('Response status:', response.status);
      
      const data = await response.json();
      console.log('Response data:', data);
      
      if (response.ok) {
        setSuccess(true);
        toast({
          title: 'Template Uploaded',
          description: 'Your PDF template has been uploaded successfully.',
        });
      } else {
        throw new Error(data.error || data.message || 'Failed to upload template');
      }
    } catch (err) {
      console.error('Error uploading template:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      toast({
        title: 'Upload Failed',
        description: err instanceof Error ? err.message : 'An unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Upload PDF Template</CardTitle>
        <CardDescription>
          Upload your Adobe PDF document generation template (.docx) file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template">Template File</Label>
            <div className="flex items-center gap-2">
              <Input 
                id="template" 
                type="file" 
                onChange={handleFileChange}
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="flex-1"
              />
            </div>
            {file && (
              <div className="text-sm flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span className="truncate">{file.name}</span>
                <span className="text-xs">({(file.size / 1024).toFixed(2)} KB)</span>
              </div>
            )}
            {error && (
              <div className="text-sm flex items-center gap-2 text-destructive mt-1">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="text-sm flex items-center gap-2 text-green-600 mt-1">
                <CheckCircle className="h-4 w-4" />
                <span>Template uploaded successfully</span>
              </div>
            )}
          </div>
          
          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={!file || uploading}
              className="w-full"
            >
              {uploading ? (
                <>
                  <span className="animate-spin mr-2">⟳</span>
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Template
                </>
              )}
            </Button>
          </div>
          
          <div className="text-xs text-muted-foreground mt-4 space-y-2 bg-gray-50 p-3 rounded-md border">
            <div className="font-medium text-sm text-gray-800">Template Requirements:</div>
            <ul className="list-disc pl-4 space-y-1">
              <li>Must be a Word document (.docx file)</li>
              <li>Must be tagged using Adobe Document Generation Tagger</li>
              <li>Should include merge fields that match the data structure</li>
              <li>Recommended size: less than 2MB</li>
            </ul>
            <div className="font-medium text-sm text-gray-800 mt-2">Important Notes:</div>
            <ul className="list-disc pl-4 space-y-1">
              <li>This will replace any existing template</li>
              <li>The template must use valid Adobe text tags like <code>&#123;&#123;company.name&#125;&#125;</code></li>
              <li>If your template has formatting issues, try simplifying the design</li>
              <li>For complex templates, consider Adobe Experience Manager (AEM) for advanced tag support</li>
            </ul>
            <div className="text-blue-600 mt-2">
              <a href="https://developer.adobe.com/document-services/docs/overview/document-generation-api/templatetags/" target="_blank" rel="noopener noreferrer" className="underline">
                Learn more about Adobe template tagging
              </a>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}