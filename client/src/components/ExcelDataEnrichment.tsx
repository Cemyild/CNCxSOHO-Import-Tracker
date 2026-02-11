
import React, { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, Check, AlertCircle, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

interface EnrichmentPreviewItem {
  procedureId: number;
  reference: string;
  matchMethod: string;
  changes: {
    field: string;
    oldValue: any;
    newValue: string;
  }[];
}

interface ExcelDataEnrichmentProps {
  onSuccess?: () => void;
}

export function ExcelDataEnrichment({ onSuccess }: ExcelDataEnrichmentProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<EnrichmentPreviewItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/enrichment/preview', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Preview generation failed');

      const data = await response.json();
      setPreviewData(data.matches);
      
      // Select all by default
      setSelectedIds(data.matches.map((m: any) => m.procedureId));
      
      if (data.matches.length === 0) {
        toast({
          title: "No matches found",
          description: "Could not match any rows in the Excel file with existing database records.",
          variant: "destructive",
        });
      } else {
        setStep('preview');
        toast({
          title: "Analysis Complete",
          description: `Found ${data.matches.length} matching records that need updates.`,
        });
      }

    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process the Excel file.",
        variant: "destructive",
      });
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setLoading(true);
    
    // Filter updates based on selection
    const updatesToApply = previewData
      .filter(item => selectedIds.includes(item.procedureId))
      .map(item => {
        // Convert changes array back to object for the API
        const changesObj: Record<string, string> = {};
        item.changes.forEach(change => {
            changesObj[change.field] = change.newValue;
        });
        return {
            procedureId: item.procedureId,
            changes: changesObj
        };
      });

    try {
      const response = await fetch('/api/enrichment/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates: updatesToApply }),
      });

      if (!response.ok) throw new Error('Update failed');

      const result = await response.json();
      
      toast({
        title: "Success",
        description: "Database records have been successfully enriched!",
        variant: "default", // or "success" if you have that variant
      });

      setOpen(false);
      setStep('upload');
      setFile(null);
      setPreviewData([]);
      
      if (onSuccess) onSuccess();

    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to apply updates.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === previewData.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(previewData.map(m => m.procedureId));
    }
  };

  const reset = () => {
    setStep('upload');
    setFile(null);
    setPreviewData([]);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if(!val) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Enrich Data (Excel)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Data Enrichment from Excel</DialogTitle>
          <DialogDescription>
            Upload an Excel file to fill missing information in existing procedures.
            System will match by Invoice No or Amount.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden p-1">
          {step === 'upload' ? (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg bg-muted/50 gap-4">
              <div className="p-4 rounded-full bg-background border shadow-sm">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">Click to upload or drag and drop</p>
                <p className="text-sm text-muted-foreground">Excel files (.xlsx, .xls)</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                Select File
              </Button>
              {file && (
                <div className="flex items-center gap-2 text-sm bg-background px-3 py-1 rounded border">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  {file.name}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col gap-4">
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium text-muted-foreground">
                  Found {previewData.length} records to update
                </div>
                <div className="text-xs text-muted-foreground">
                    Selected: {selectedIds.length}
                </div>
              </div>
              
              <div className="border rounded-md flex-1 overflow-hidden relative">
                <ScrollArea className="h-full">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox 
                            checked={selectedIds.length === previewData.length && previewData.length > 0} 
                            onCheckedChange={toggleAll}
                          />
                        </TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Match Method</TableHead>
                        <TableHead>Changes (Field: Old &rarr; New)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                        {previewData.map((item) => (
                            <TableRow key={item.procedureId} className={selectedIds.includes(item.procedureId) ? "" : "opacity-50"}>
                                <TableCell>
                                    <Checkbox 
                                        checked={selectedIds.includes(item.procedureId)}
                                        onCheckedChange={() => toggleSelection(item.procedureId)}
                                    />
                                </TableCell>
                                <TableCell className="font-medium">{item.reference}</TableCell>
                                <TableCell>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                        item.matchMethod === 'invoice_no' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                        {item.matchMethod}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1">
                                        {item.changes.map((change, idx) => (
                                            <div key={idx} className="text-sm grid grid-cols-[120px_1fr] gap-2 items-center">
                                                <span className="font-mono text-xs text-muted-foreground">{change.field}:</span>
                                                <div className="flex items-center gap-1.5 ">
                                                    <span className="text-red-400 line-through text-xs">{change.oldValue || "(empty)"}</span>
                                                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                                    <span className="text-green-600 font-medium">{change.newValue}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'upload' ? (
             <Button onClick={handleUpload} disabled={!file || loading}>
                {loading ? "Analyzing..." : "Preview Changes"}
             </Button>
          ) : (
            <div className="flex w-full justify-between">
                <Button variant="ghost" onClick={reset}>Back to Upload</Button>
                <Button onClick={handleApply} disabled={selectedIds.length === 0 || loading}>
                    {loading ? "Updating..." : `Apply ${selectedIds.length} Updates`}
                </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
