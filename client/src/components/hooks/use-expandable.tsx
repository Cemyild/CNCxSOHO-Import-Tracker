import { useState } from "react";
import { useSpring } from "framer-motion";

export function useExpandable() {
  const [isExpanded, setIsExpanded] = useState(false);
  const animatedHeight = useSpring(0);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return {
    isExpanded,
    toggleExpand,
    animatedHeight,
  };
}