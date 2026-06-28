import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

export function UploadTemplateHelp() {
  const { t } = useTranslation();
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('uploadTemplateHelp.cardTitle')}</CardTitle>
        <CardDescription>
          {t('uploadTemplateHelp.cardDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-base mb-2">{t('uploadTemplateHelp.structureTitle')}</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('uploadTemplateHelp.structure1')} <code>&#123;&#123;tagname&#125;&#125;</code></li>
              <li>{t('uploadTemplateHelp.structure2pre')} <code>&#123;&#123;#each items&#125;&#125;</code> {t('uploadTemplateHelp.structure2post')}</li>
              <li>{t('uploadTemplateHelp.structure3pre')} <code>&#123;&#123;/each&#125;&#125;</code> {t('uploadTemplateHelp.structure3post')}</li>
              <li>{t('uploadTemplateHelp.structure4')} <code>&#123;&#123;`tag`&#125;&#125;</code></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-base mb-2">{t('uploadTemplateHelp.examplesTitle')}</h3>
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
            <h3 className="font-medium text-base mb-2">{t('uploadTemplateHelp.dataStructureTitle')}</h3>
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