import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Add title to the document
document.title = "Blank Project with Sidebar";

createRoot(document.getElementById("root")!).render(<App />);
