import { Badge } from "@/components/ui/badge";

interface RequirementsBadgeProps {
  requirements?: {
    ex_registry_form?: boolean;
    azo_dye_test?: boolean;
    special_custom?: boolean;
  };
}

export function RequirementsBadge({ requirements }: RequirementsBadgeProps) {
  if (!requirements) return null;

  const badges = [];
  
  if (requirements.ex_registry_form) {
    badges.push(
      <Badge key="ex-registry" variant="destructive" className="bg-red-500">
        🔴 EX REGISTRY FORM
      </Badge>
    );
  }
  
  if (requirements.azo_dye_test) {
    badges.push(
      <Badge key="azo-dye" variant="destructive" className="bg-orange-500">
        🟠 AZO DYE TEST
      </Badge>
    );
  }
  
  if (requirements.special_custom) {
    badges.push(
      <Badge key="special-custom" variant="destructive" className="bg-red-600">
        🔴 SPECIAL CUSTOM
      </Badge>
    );
  }

  if (badges.length === 0) return null;

  return <div className="flex gap-2 flex-wrap">{badges}</div>;
}
