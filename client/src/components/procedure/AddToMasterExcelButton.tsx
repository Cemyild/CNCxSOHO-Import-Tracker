import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Loader2 } from "lucide-react";

interface Props {
  procedureReference: string;
}

async function readMaybeJson(res: Response): Promise<any> {
  try {
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AddToMasterExcelButton({ procedureReference }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const appendAndDownload = async () => {
    const res = await fetch(
      `/api/procedures/${encodeURIComponent(procedureReference)}/append-to-master-excel`,
      { method: "POST", credentials: "include" }
    );

    if (res.status === 412) {
      const data = await readMaybeJson(res);
      throw Object.assign(new Error(data?.message ?? "Master excel not uploaded yet"), {
        kind: "master_not_uploaded" as const,
      });
    }
    if (!res.ok) {
      const data = await readMaybeJson(res);
      throw new Error(data?.error ?? data?.detail ?? `Append failed (${res.status})`);
    }

    const blob = await res.blob();
    triggerDownload(blob, "master-import-list.xlsx");
    toast({
      title: t("procedurePages.masterExcel.updatedTitle"),
      description: t("procedurePages.masterExcel.updatedDescription", { reference: procedureReference }),
    });
  };

  const handleClick = async () => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      await appendAndDownload();
    } catch (err: any) {
      if (err?.kind === "master_not_uploaded") {
        toast({
          title: t("procedurePages.masterExcel.notUploadedTitle"),
          description: t("procedurePages.masterExcel.notUploadedDescription"),
        });
        fileInputRef.current?.click();
      } else {
        toast({
          title: t("common.error"),
          description: err?.message ?? t("procedurePages.masterExcel.appendFailed"),
          variant: "destructive",
        });
      }
    } finally {
      setIsWorking(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setIsWorking(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/master-excel/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!upRes.ok) {
        const data = await readMaybeJson(upRes);
        throw new Error(data?.error ?? `Upload failed (${upRes.status})`);
      }
      await appendAndDownload();
    } catch (err: any) {
      toast({
        title: t("common.error"),
        description: err?.message ?? t("procedurePages.masterExcel.uploadFailed"),
        variant: "destructive",
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={isWorking}
        data-testid="button-append-master-excel"
      >
        {isWorking ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="mr-2 h-4 w-4" />
        )}
        {t("procedurePages.masterExcel.buttonLabel")}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
}
