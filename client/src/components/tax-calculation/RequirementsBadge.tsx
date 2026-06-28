import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

interface RequirementsBadgeProps {
  requirements?: {
    ex_registry_form?: boolean;
    azo_dye_test?: boolean;
    special_custom?: boolean;
  };
}

export function RequirementsBadge({ requirements }: RequirementsBadgeProps) {
  const { t } = useTranslation();
  if (!requirements) return null;

  const badges = [];

  if (requirements.ex_registry_form) {
    badges.push(
      <Badge key="ex-registry" variant="destructive" className="bg-red-500">
        🔴 {t('taxCalcComp.requirements.exRegistryForm')}
      </Badge>
    );
  }

  if (requirements.azo_dye_test) {
    badges.push(
      <Badge key="azo-dye" variant="destructive" className="bg-orange-500">
        🟠 {t('taxCalcComp.requirements.azoDyeTest')}
      </Badge>
    );
  }

  if (requirements.special_custom) {
    badges.push(
      <Badge key="special-custom" variant="destructive" className="bg-red-600">
        🔴 {t('taxCalcComp.requirements.specialCustom')}
      </Badge>
    );
  }

  if (badges.length === 0) return null;

  return <div className="flex gap-2 flex-wrap">{badges}</div>;
}
