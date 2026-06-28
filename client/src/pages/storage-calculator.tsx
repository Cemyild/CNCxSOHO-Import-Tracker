import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CalendarIcon, RefreshCw, Warehouse } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Storage tariff (USD). Daily flat charge is the same across all brackets;
// only the per-kg rate changes by bracket.
const FLAT_DAILY_USD = 94;
const RATE_A_USD_PER_KG = 0.088; // day 1
const RATE_B_USD_PER_KG = 0.109; // days 2-3
const RATE_C_USD_PER_KG = 0.161; // days 4-14
const RATE_D_USD_PER_KG = 0.192; // day 15+
const RATE_E_USD_PER_KG = 0.110; // one-time handling

type Breakdown = {
  currentDay: number;
  hoursElapsed: number;
  daysA: number;
  daysB: number;
  daysC: number;
  daysD: number;
  amountA: number;
  amountB: number;
  amountC: number;
  amountD: number;
  amountE: number;
  total: number;
};

function computeStorageFee(weightKg: number, startAt: Date, now: Date): Breakdown | null {
  const msElapsed = now.getTime() - startAt.getTime();
  if (msElapsed <= 0) return null;

  const hoursElapsed = msElapsed / (1000 * 60 * 60);
  // Any portion of a 24h window counts as that day entered.
  const currentDay = Math.max(1, Math.ceil(hoursElapsed / 24));

  const daysA = Math.min(currentDay, 1);
  const daysB = Math.max(0, Math.min(currentDay, 3) - 1);
  const daysC = Math.max(0, Math.min(currentDay, 14) - 3);
  const daysD = Math.max(0, currentDay - 14);

  const amountA = daysA * (FLAT_DAILY_USD + weightKg * RATE_A_USD_PER_KG);
  const amountB = daysB * (FLAT_DAILY_USD + weightKg * RATE_B_USD_PER_KG);
  const amountC = daysC * (FLAT_DAILY_USD + weightKg * RATE_C_USD_PER_KG);
  const amountD = daysD * (FLAT_DAILY_USD + weightKg * RATE_D_USD_PER_KG);
  const amountE = weightKg * RATE_E_USD_PER_KG;

  return {
    currentDay,
    hoursElapsed,
    daysA,
    daysB,
    daysC,
    daysD,
    amountA,
    amountB,
    amountC,
    amountD,
    amountE,
    total: amountA + amountB + amountC + amountD + amountE,
  };
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTry(n: number): string {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ISTANBUL_FMT = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  dateStyle: "medium",
  timeStyle: "short",
});

function BreakdownRow({
  label,
  range,
  days,
  amount,
}: {
  label: string;
  range: string;
  days: number | null;
  amount: number;
}) {
  const dim = days === 0;
  return (
    <tr className={cn("border-b last:border-0", dim && "text-muted-foreground")}>
      <td className="py-2 pr-2 font-mono">{label}</td>
      <td className="py-2 pr-2">{range}</td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {days === null ? "—" : days}
      </td>
      <td className="py-2 text-right tabular-nums">${fmtUsd(amount)}</td>
    </tr>
  );
}

export default function StorageCalculatorPage() {
  const { t } = useTranslation();
  const [weightKg, setWeightKg] = useState<string>("");
  const [startAt, setStartAt] = useState<Date | undefined>(undefined);
  const [timeStr, setTimeStr] = useState<string>("00:00");
  const [now, setNow] = useState<Date>(() => new Date());

  // USD/TRY rate: auto-fetched from TCMB if available, otherwise manual.
  const [rateInput, setRateInput] = useState<string>("");
  const [rateSource, setRateSource] = useState<"TCMB" | "manual" | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState<boolean>(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const fetchRate = async () => {
    setRateLoading(true);
    setRateError(null);
    try {
      const res = await fetch("/api/usdtl-rate");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.rate !== "number" || data.rate <= 0) {
        throw new Error(t('storageCalc.invalidRate'));
      }
      setRateInput(data.rate.toFixed(4));
      setRateSource("TCMB");
      setRateDate(data.date ?? null);
    } catch (err: any) {
      setRateError(t('storageCalc.rateAutoFailed'));
      setRateSource(null);
    } finally {
      setRateLoading(false);
    }
  };

  // Refresh "now" every 30s so the running total stays current.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Try to auto-fetch the official USD/TRY rate on mount.
  useEffect(() => {
    fetchRate();
  }, []);

  const handleRateInputChange = (value: string) => {
    setRateInput(value);
    // Once the user edits the field, it's a manual override.
    setRateSource("manual");
    setRateDate(null);
    setRateError(null);
  };

  // Combine date + time into a single Date object whenever both are set
  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      setStartAt(undefined);
      return;
    }
    const [hh, mm] = timeStr.split(":").map((s) => parseInt(s, 10) || 0);
    const next = new Date(date);
    next.setHours(hh, mm, 0, 0);
    setStartAt(next);
  };

  const handleTimeChange = (value: string) => {
    setTimeStr(value);
    if (startAt) {
      const [hh, mm] = value.split(":").map((s) => parseInt(s, 10) || 0);
      const next = new Date(startAt);
      next.setHours(hh, mm, 0, 0);
      setStartAt(next);
    }
  };

  const weightNum = parseFloat(weightKg);
  const weightValid = !isNaN(weightNum) && weightNum > 0;
  const canCalculate = weightValid && !!startAt;

  const rateNum = parseFloat(rateInput);
  const rateValid = !isNaN(rateNum) && rateNum > 0;

  const breakdown = useMemo(() => {
    if (!canCalculate || !startAt) return null;
    return computeStorageFee(weightNum, startAt, now);
  }, [canCalculate, weightNum, startAt, now]);

  const totalTry = breakdown && rateValid ? breakdown.total * rateNum : null;

  return (
    <PageLayout title={t('nav.storageCalculator')}>
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Warehouse className="h-6 w-6 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t('nav.storageCalculator')}</h2>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-5">
          {/* Total Chargeable Weight */}
          <div className="space-y-2">
            <Label htmlFor="weight">{t('storageCalc.totalChargeableWeight')}</Label>
            <div className="relative">
              <Input
                id="weight"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                className="pr-12"
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground pointer-events-none">
                kg
              </span>
            </div>
          </div>

          {/* Starting Date / Time */}
          <div className="space-y-2">
            <Label>{t('storageCalc.startingDateTime')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !startAt && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startAt ? (
                    format(startAt, "PPP 'at' HH:mm")
                  ) : (
                    <span>{t('storageCalc.pickDateTime')}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startAt}
                  onSelect={handleDateSelect}
                  initialFocus
                />
                <div className="border-t p-3 flex items-center gap-2">
                  <Label htmlFor="time" className="text-sm">
                    {t('storageCalc.time')}
                  </Label>
                  <Input
                    id="time"
                    type="time"
                    value={timeStr}
                    onChange={(e) => handleTimeChange(e.target.value)}
                    className="w-32"
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* USD/TRY Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="rate">{t('storageCalc.usdTryRate')}</Label>
              <span className="text-xs text-muted-foreground">
                {rateLoading
                  ? t('storageCalc.loading')
                  : rateSource === "TCMB"
                    ? `TCMB${rateDate ? ` · ${rateDate}` : ""}`
                    : rateSource === "manual"
                      ? t('storageCalc.manual')
                      : rateError ?? ""}
              </span>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="rate"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  placeholder="0.0000"
                  value={rateInput}
                  onChange={(e) => handleRateInputChange(e.target.value)}
                  className="pr-12"
                />
                <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground pointer-events-none">
                  TRY
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={fetchRate}
                disabled={rateLoading}
                title={t('storageCalc.refreshTcmb')}
              >
                <RefreshCw
                  className={cn("h-4 w-4", rateLoading && "animate-spin")}
                />
              </Button>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-muted-foreground">{t('storageCalc.result')}</div>
            <div className="text-xs text-muted-foreground">
              {t('storageCalc.nowIstanbul', { time: ISTANBUL_FMT.format(now) })}
            </div>
          </div>

          {!canCalculate ? (
            <div className="text-sm text-muted-foreground">
              {t('storageCalc.fillBothFields')}
            </div>
          ) : !breakdown ? (
            <div className="text-sm text-amber-600 dark:text-amber-400">
              {t('storageCalc.startNotPassed')}
            </div>
          ) : (
            <>
              <div className="text-sm space-y-1">
                <div>
                  {t('storageCalc.chargeableWeight')}{" "}
                  <span className="font-medium text-foreground">
                    {weightNum.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} kg
                  </span>
                </div>
                <div>
                  {t('storageCalc.start')}{" "}
                  <span className="font-medium text-foreground">
                    {format(startAt!, "PPP HH:mm")}
                  </span>
                </div>
                <div>
                  {t('storageCalc.elapsed')}{" "}
                  <span className="font-medium text-foreground">
                    {t('storageCalc.elapsedValue', {
                      hours: Math.floor(breakdown.hoursElapsed),
                      minutes: Math.floor((breakdown.hoursElapsed % 1) * 60),
                    })}
                  </span>
                  {" — "}
                  <span className="font-medium text-foreground">
                    {t('storageCalc.dayN', { day: breakdown.currentDay })}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2 pr-2 font-normal">{t('storageCalc.bracket')}</th>
                      <th className="text-left py-2 pr-2 font-normal">{t('storageCalc.range')}</th>
                      <th className="text-right py-2 pr-2 font-normal">{t('storageCalc.days')}</th>
                      <th className="text-right py-2 font-normal">{t('storageCalc.amountUsd')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <BreakdownRow
                      label="A"
                      range={t('storageCalc.rangeDay1')}
                      days={breakdown.daysA}
                      amount={breakdown.amountA}
                    />
                    <BreakdownRow
                      label="B"
                      range={t('storageCalc.rangeDays23')}
                      days={breakdown.daysB}
                      amount={breakdown.amountB}
                    />
                    <BreakdownRow
                      label="C"
                      range={t('storageCalc.rangeDays414')}
                      days={breakdown.daysC}
                      amount={breakdown.amountC}
                    />
                    <BreakdownRow
                      label="D"
                      range={t('storageCalc.rangeDay15')}
                      days={breakdown.daysD}
                      amount={breakdown.amountD}
                    />
                    <BreakdownRow
                      label="E"
                      range={t('storageCalc.rangeHandling')}
                      days={null}
                      amount={breakdown.amountE}
                    />
                  </tbody>
                  <tfoot className="border-t">
                    <tr>
                      <td colSpan={3} className="text-right py-3 pr-2 font-semibold">
                        {t('storageCalc.total')}
                      </td>
                      <td className="text-right py-3 font-semibold tabular-nums">
                        ${fmtUsd(breakdown.total)}
                      </td>
                    </tr>
                    {totalTry !== null && (
                      <tr>
                        <td
                          colSpan={3}
                          className="text-right py-1 pr-2 text-sm text-muted-foreground"
                        >
                          {t('storageCalc.totalTry', { rate: rateNum.toFixed(4) })}
                        </td>
                        <td className="text-right py-1 font-semibold tabular-nums text-primary">
                          ₺{fmtTry(totalTry)}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {totalTry === null && (
                <div className="text-xs text-muted-foreground italic">
                  {t('storageCalc.enterValidRate')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
