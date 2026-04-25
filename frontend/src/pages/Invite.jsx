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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
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
    if (password !== confirm) return setError("Passwords do not match");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    try {
      const { data } = await api.post("/auth/register", {
        invite_token: token,
        name,
        password,
      });
      loginWithToken(data.token, data.user);
      setDone(true);
    } catch (err) {
      setError(formatApiError(err?.response?.data?.detail) || "Register failed");
    }
  };

  return (
    <div className={invitePageShellClass}>
      <div className={cn("p-6 sm:p-8", pageCardClass)}>
        <InviteRegistrationForm
          inviteStatus={inviteStatus}
          email={email}
          name={name}
          onNameChange={setName}
          password={password}
          onPasswordChange={setPassword}
          confirm={confirm}
          onConfirmChange={setConfirm}
          error={error}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}
