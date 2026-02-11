import { WorldMapDemo } from "@/components/ui/world-map-demo";
import { SignInDialog } from "@/components/ui/sign-in-dialog";
import { ShineBorder } from "@/components/ui/shine-border";

export default function LoginPage() {
  return (
    <div className="h-screen w-screen bg-white overflow-hidden flex items-center justify-center">
      <div className="w-full h-full">
        <WorldMapDemo />
      </div>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center space-y-12">
        {/* Company Logos with Shine Border */}
        <ShineBorder
          className="bg-white/80 backdrop-blur-sm p-6 rounded-lg"
          color={["#00BFFF", "#4A9EFF", "#0080FF"]}
          borderRadius={12}
          borderWidth={2}
          duration={10}
        >
          <div className="flex items-center justify-center gap-12">
            <img 
              src="/assets/logos/soho-logo.png" 
              alt="SOHO Logo" 
              className="h-35 w-auto object-contain"
            />
            <img 
              src="/assets/logos/cnc-logo.png" 
              alt="CNC Logo" 
              className="h-35 w-auto object-contain"
            />
          </div>
        </ShineBorder>
        
        <SignInDialog />
      </div>
    </div>
  );
}