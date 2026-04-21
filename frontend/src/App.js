import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/app/ProtectedRoute";
import Layout from "./components/app/Layout";
import Login from "./pages/Login";
import Invite from "./pages/Invite";
import CalendarPage from "./pages/Calendar";
import Requests from "./pages/Requests";
import CalendarsAdmin from "./pages/Calendars";
import Members from "./pages/Members";
import Profile from "./pages/Profile";
import { Toaster } from "./components/ui/sonner";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/invite/:token" element={<Invite />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<CalendarPage />} />
              <Route path="/requests" element={<Requests />} />
              <Route
                path="/calendars"
                element={
                  <ProtectedRoute adminOnly>
                    <CalendarsAdmin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/members"
                element={
                  <ProtectedRoute adminOnly>
                    <Members />
                  </ProtectedRoute>
                }
              />
              <Route path="/profile" element={<Profile />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </div>
  );
}

export default App;
