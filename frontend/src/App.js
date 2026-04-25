import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/app/ProtectedRoute";
import Layout from "./components/app/Layout";
import PageEnterMotion from "./components/app/PageEnterMotion";
import Login from "./pages/Login";
import Invite from "./pages/Invite";
import CalendarPage from "./pages/Calendar";
import Requests from "./pages/Requests";
import CalendarsAdmin from "./pages/Calendars";
import Members from "./pages/Members";
import Profile from "./pages/Profile";
import OnboardingPreview from "./pages/OnboardingPreview";
import MembersPreview from "./pages/MembersPreview";
import { Toaster } from "./components/ui/sonner";

function App() {
  return (
    <div className="App h-full min-h-0">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={
                <PageEnterMotion className="min-h-dvh">
                  <Login />
                </PageEnterMotion>
              }
            />
            <Route
              path="/invite/:token"
              element={
                <PageEnterMotion className="min-h-dvh">
                  <Invite />
                </PageEnterMotion>
              }
            />
            {process.env.NODE_ENV === "development" && (
              <>
                <Route
                  path="/preview/onboarding"
                  element={
                    <PageEnterMotion className="min-h-dvh">
                      <OnboardingPreview />
                    </PageEnterMotion>
                  }
                />
                <Route
                  path="/preview/members/:role"
                  element={
                    <PageEnterMotion className="min-h-dvh">
                      <MembersPreview />
                    </PageEnterMotion>
                  }
                />
              </>
            )}
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
                  <ProtectedRoute membersPage>
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
