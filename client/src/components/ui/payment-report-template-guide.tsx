import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function PaymentReportTemplateGuide() {
  const { t } = useTranslation();
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t('reportTemplateGuide.title')}</CardTitle>
        <CardDescription>
          {t('reportTemplateGuide.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('reportTemplateGuide.criticalTitle')}</AlertTitle>
          <AlertDescription>
            {t('reportTemplateGuide.criticalDesc')}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-lg mb-2">{t('reportTemplateGuide.requiredStructure')}</h3>
            <ul className="list-disc pl-5 space-y-2">
              <li>{t('reportTemplateGuide.rule1Before')} <code>{"{{tagname}}"}</code> {t('reportTemplateGuide.rule1After')}</li>
              <li><strong>{t('reportTemplateGuide.rule2Strong')}</strong> {t('reportTemplateGuide.rule2Mid')} <code>{"{{#each items}}"}</code> {t('reportTemplateGuide.rule2After')}</li>
              <li><strong>{t('reportTemplateGuide.rule3Strong')}</strong> {t('reportTemplateGuide.rule3Mid')} <code>{"{{/each}}"}</code> {t('reportTemplateGuide.rule3After')}</li>
              <li>{t('reportTemplateGuide.rule4Before')} <strong>{t('reportTemplateGuide.rule4Strong')}</strong> {t('reportTemplateGuide.rule4After')}</li>
              <li>{t('reportTemplateGuide.rule5')}</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-lg mb-2">{t('reportTemplateGuide.exampleTitle')}</h3>
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
              {t('reportTemplateGuide.bestResults')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}