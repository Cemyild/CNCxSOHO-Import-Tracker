import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";

type Mode = "single" | "multi" | "dateRange" | "all";

export default function BulkDownloadPage() {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <PageLayout title="Bulk Document Download">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Bulk Document Download</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="multi">Multi-select</TabsTrigger>
              <TabsTrigger value="dateRange">Date Range</TabsTrigger>
              <TabsTrigger value="all">Everything</TabsTrigger>
            </TabsList>

            <TabsContent value="single">
              <p className="text-sm text-muted-foreground p-4">Single procedure tab — TODO</p>
            </TabsContent>
            <TabsContent value="multi">
              <p className="text-sm text-muted-foreground p-4">Multi-select tab — TODO</p>
            </TabsContent>
            <TabsContent value="dateRange">
              <p className="text-sm text-muted-foreground p-4">Date range tab — TODO</p>
            </TabsContent>
            <TabsContent value="all">
              <p className="text-sm text-muted-foreground p-4">Everything tab — TODO</p>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">Selection: —</div>
            <Button disabled>
              <Download className="mr-2 h-4 w-4" />
              Download ZIP
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
