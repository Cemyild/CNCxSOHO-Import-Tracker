import { format, getISOWeek } from 'date-fns';
import { enUS, tr } from 'date-fns/locale';
import type { TFunction } from 'i18next';

/**
 * Eğilim (trend) grafiklerinin dönem etiketlerini kullanıcının seçtiği dilde üretir.
 *
 * Etiketler önceden sunucuda oluşturuluyordu: gider ucu her zaman İngilizce
 * ("January 2026"), vergi ucu ise sunucunun yerel ayarına göre ("Ocak 2026")
 * döndürüyordu. Yani aynı ekrandaki iki grafik farklı dilde yazıyor ve hiçbiri
 * arayüz dilini dikkate almıyordu. Artık sunucudan gelen tarihi temel alıp
 * etiketi burada üretiyoruz.
 *
 * @param rawDate    Sunucudan gelen dönem tarihi (ay için ayın ilki, hafta için
 *                   ISO haftasının pazartesisi)
 * @param groupBy    'month' | 'week'
 * @param language   i18n.language (ör. "tr", "en")
 * @param t          i18next çeviri fonksiyonu (hafta etiketi için)
 * @param fallback   Tarih okunamazsa gösterilecek metin (sunucunun etiketi)
 */
export function formatPeriodLabel(
  rawDate: string | Date | undefined | null,
  groupBy: 'month' | 'week',
  language: string,
  t: TFunction,
  fallback: string,
): string {
  if (!rawDate) return fallback;

  const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (Number.isNaN(date.getTime())) return fallback;

  const locale = language?.startsWith('tr') ? tr : enUS;

  if (groupBy === 'month') {
    return format(date, 'LLLL yyyy', { locale });
  }

  return t('reportsPages.chart.weekPeriod', {
    week: String(getISOWeek(date)),
    year: format(date, 'yyyy'),
  });
}
