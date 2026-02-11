import React, { createContext, useContext, useState } from "react";

type CardsContextType = {
  isAllExpanded: boolean;
  setAllExpanded: (expanded: boolean) => void;
  toggleAllExpanded: () => void;
};

const CardsContext = createContext<CardsContextType | undefined>(undefined);

export function CardsProvider({ children }: { children: React.ReactNode }) {
  const [isAllExpanded, setIsAllExpanded] = useState(false);

  const setAllExpanded = (expanded: boolean) => {
    setIsAllExpanded(expanded);
  };

  const toggleAllExpanded = () => {
    setIsAllExpanded(!isAllExpanded);
  };

  return (
    <CardsContext.Provider
      value={{
        isAllExpanded,
        setAllExpanded,
        toggleAllExpanded
      }}
    >
      {children}
    </CardsContext.Provider>
  );
}

export function useCardsContext() {
  const context = useContext(CardsContext);
  if (context === undefined) {
    throw new Error("useCardsContext must be used within a CardsProvider");
  }
  return context;
}