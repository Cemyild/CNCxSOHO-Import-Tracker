import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function PaymentReportTemplateGuide() {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Payment Report Template Guide</CardTitle>
        <CardDescription>
          Follow these guidelines to create templates that work with Adobe PDF Services
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Critical Template Requirements</AlertTitle>
          <AlertDescription>
            Your payment report templates must strictly follow Adobe's formatting rules to work properly.
          </AlertDescription>
        </Alert>
        
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-lg mb-2">Required Template Structure</h3>
            <ul className="list-disc pl-5 space-y-2">
              <li>All tags must be in the format <code>{"{{tagname}}"}</code> with no backticks or special formatting</li>
              <li><strong>Loop tags</strong> like <code>{"{{#each items}}"}</code> must be on their own separate line</li>
              <li><strong>Closing tags</strong> like <code>{"{{/each}}"}</code> must also be on their own separate line</li>
              <li>Tables should be created <strong>after</strong> an each tag, not wrapped by the each tag</li>
              <li>Avoid complex Word formatting that might interfere with tag recognition</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-lg mb-2">Working Template Example</h3>
            <div className="bg-slate-50 p-4 rounded font-mono text-sm whitespace-pre">
{`PAYMENT REPORT

Generated on: {{report_date}}

Payment Summary:
Total Payments: {{summary.total_payments_received}}
Total Distributed: {{summary.total_distributed}}
Pending: {{summary.total_pending_distribution}}

{{#each payments}}
Payment ID: {{id}}
Date: {{date}}
Amount: {{amount}}
Status: {{status}}
{{/each}}`}
            </div>
          </div>
          
          <div className="pt-2">
            <p className="text-sm text-slate-600">
              For best results, create your template in a simple text editor first, then copy to Word and add minimal formatting.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}