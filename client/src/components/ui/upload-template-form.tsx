import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

export function UploadTemplateForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

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
      setError(t('uploadTemplateForm.invalidDocxError'));
      setFile(null);
      return;
    }
    
    setFile(selectedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      setError(t('uploadTemplateForm.selectFileError'));
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
          title: t('uploadTemplateForm.uploadedToastTitle'),
          description: t('uploadTemplateForm.uploadedToastDesc'),
        });
      } else {
        throw new Error(data.error || data.message || t('uploadTemplateForm.uploadFailedError'));
      }
    } catch (err) {
      console.error('Error uploading template:', err);
      setError(err instanceof Error ? err.message : t('uploadTemplateForm.unknownError'));
      toast({
        title: t('uploadTemplateForm.uploadFailedToastTitle'),
        description: err instanceof Error ? err.message : t('uploadTemplateForm.unknownError'),
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{t('uploadTemplateForm.cardTitle')}</CardTitle>
        <CardDescription>
          {t('uploadTemplateForm.cardDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template">{t('uploadTemplateForm.templateFileLabel')}</Label>
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
                <span>{t('uploadTemplateForm.successMessage')}</span>
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
                  {t('uploadTemplateForm.uploading')}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {t('uploadTemplateForm.uploadButton')}
                </>
              )}
            </Button>
          </div>
          
          <div className="text-xs text-muted-foreground mt-4 space-y-2 bg-gray-50 p-3 rounded-md border">
            <div className="font-medium text-sm text-gray-800">{t('uploadTemplateForm.requirementsTitle')}</div>
            <ul className="list-disc pl-4 space-y-1">
              <li>{t('uploadTemplateForm.req1')}</li>
              <li>{t('uploadTemplateForm.req2')}</li>
              <li>{t('uploadTemplateForm.req3')}</li>
              <li>{t('uploadTemplateForm.req4')}</li>
            </ul>
            <div className="font-medium text-sm text-gray-800 mt-2">{t('uploadTemplateForm.notesTitle')}</div>
            <ul className="list-disc pl-4 space-y-1">
              <li>{t('uploadTemplateForm.note1')}</li>
              <li>{t('uploadTemplateForm.note2')} <code>&#123;&#123;company.name&#125;&#125;</code></li>
              <li>{t('uploadTemplateForm.note3')}</li>
              <li>{t('uploadTemplateForm.note4')}</li>
            </ul>
            <div className="text-blue-600 mt-2">
              <a href="https://developer.adobe.com/document-services/docs/overview/document-generation-api/templatetags/" target="_blank" rel="noopener noreferrer" className="underline">
                {t('uploadTemplateForm.learnMore')}
              </a>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}