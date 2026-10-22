import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import UpdateBanner from "./UpdateBanner.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <UpdateBanner />
  </React.StrictMode>
);
