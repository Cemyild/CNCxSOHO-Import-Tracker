import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function UploadTemplateHelp() {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Adobe PDF Template Instructions</CardTitle>
        <CardDescription>
          Follow these guidelines to create effective Adobe PDF templates
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-base mb-2">Template Structure - Important!</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Adobe PDF Services tags must be properly formatted as <code>&#123;&#123;tagname&#125;&#125;</code></li>
              <li>For loops like <code>&#123;&#123;#each items&#125;&#125;</code> must be on their own line</li>
              <li>Loop end tags <code>&#123;&#123;/each&#125;&#125;</code> must also be on their own line</li>
              <li>Never place tags with backticks like <code>&#123;&#123;`tag`&#125;&#125;</code></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-base mb-2">Working Examples</h3>
            <div className="bg-gray-100 p-3 rounded text-sm font-mono whitespace-pre mb-2">
{`{{title}}

{{subtitle}}

{{#each payments}}
ID: {{id}}
Date: {{date}}
Amount: {{amount}}
{{/each}}`}
            </div>
          </div>
          
          <div>
            <h3 className="font-medium text-base mb-2">Data Structure</h3>
            <div className="bg-gray-100 p-3 rounded text-sm font-mono whitespace-pre">
{`{
  "title": "Report Title",
  "subtitle": "Generated on...",
  "payments": [
    {
      "id": "PAY001",
      "date": "15.05.2025",
      "amount": "€1,245,600.00"
    }
  ]
}`}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}