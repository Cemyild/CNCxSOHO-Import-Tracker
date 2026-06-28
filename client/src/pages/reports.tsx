import { BarChart2, Receipt, SlidersHorizontal, ArrowRight } from "lucide-react"
import { Link } from "wouter"
import { useTranslation } from "react-i18next"
import { PageLayout } from "@/components/layout/PageLayout"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"

type ReportCard = {
  title: string
  description: string
  href: string
  cta: string
  icon: typeof BarChart2
}

export default function ReportsPage() {
  const { t } = useTranslation()

  const reportCards: ReportCard[] = [
    {
      title: t('reportsPages.hub.expenseAnalyticsTitle'),
      description: t('reportsPages.hub.expenseAnalyticsDesc'),
      href: "/analytics",
      cta: t('reportsPages.hub.viewAnalytics'),
      icon: BarChart2,
    },
    {
      title: t('reportsPages.hub.taxAnalyticsTitle'),
      description: t('reportsPages.hub.taxAnalyticsDesc'),
      href: "/taxreport",
      cta: t('reportsPages.hub.viewTaxes'),
      icon: Receipt,
    },
    {
      title: t('reportsPages.hub.customReportsTitle'),
      description: t('reportsPages.hub.customReportsDesc'),
      href: "/customreport",
      cta: t('reportsPages.hub.createReport'),
      icon: SlidersHorizontal,
    },
  ]

  return (
    <PageLayout title={t('nav.reports')}>
      <h1 className="text-3xl font-bold tracking-tight mb-6">{t('reportsPages.hub.dashboardTitle')}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportCards.map(({ title, description, href, cta, icon: Icon }) => (
          <Link key={href} href={href} aria-label={title}>
            <Card className="group h-full cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <Icon className="h-8 w-8 text-primary" />
                  <CardTitle className="text-xl">{title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-4">{description}</CardDescription>
                <span className={buttonVariants({ className: "group-hover:gap-3 transition-all" })}>
                  {cta}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </PageLayout>
  )
}
