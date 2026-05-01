import React, { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import InviteRegistrationForm from "../components/invite/InviteRegistrationForm";
import { invitePageShellClass } from "../lib/inviteOnboardingTheme";
import { pageCardClass } from "../lib/pageTheme";
import { cn } from "@/lib/utils";

export default function Invite() {
  const { token } = useParams();
  const { loginWithToken, user } = useAuth();
  const [email, setEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("loading");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sauce, setSauce] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (token === "preview-token") {
      setEmail("member@studio7.miami");
      setInviteStatus("ok");
      return;
    }
    api
      .get(`/auth/invite/${token}`)
      .then((r) => {
        setEmail(r.data.email);
        setInviteStatus("ok");
      })
      .catch((e) => {
        setError(formatApiError(e?.response?.data?.detail) || "Invalid invite");
        setInviteStatus("bad");
      });
  }, [token]);

  if (done && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (token === "preview-token") {
      window.alert("Preview mode — this does not create an account.");
      return;
    }
    if (password !== confirm) return setError("Passwords do not match");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (!phone.trim()) return setError("Enter your phone number.");
    if (!sauce) return setError("Choose what's your sauce.");
    try {
      const { data } = await api.post("/auth/register", {
        invite_token: token,
        name,
        password,
        phone_e164: phone,
        sauce,
      });
      loginWithToken(data.token, data.user);
      setDone(true);
    } catch (err) {
      setError(formatApiError(err?.response?.data?.detail) || "Register failed");
    }
  };

  return (
    <div className={invitePageShellClass}>
      <div className="w-full max-w-md">
        <img
          src="/brand/logo.png"
          alt="Studio 7 Miami"
          className="mx-auto mb-6 w-44 sm:w-52 h-auto"
        />
        <div className={cn("p-6 sm:p-8", pageCardClass)}>
        <InviteRegistrationForm
          inviteStatus={inviteStatus}
          eyebrow={null}
          email={email}
          name={name}
          onNameChange={setName}
          phone={phone}
          onPhoneChange={setPhone}
          sauce={sauce}
          onSauceChange={setSauce}
          password={password}
          onPasswordChange={setPassword}
          confirm={confirm}
          onConfirmChange={setConfirm}
          error={error}
          onSubmit={submit}
          onStepChange={(s) => {
            if (s < 3) setError("");
          }}
        />
      </div>
      </div>
    </div>
  );
}
