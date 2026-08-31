import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { EMPTY_PROPOSAL, isBlankProposal, normalizeProposal, proposalActionPayload, serializeProposal, statusLabel } from "../lib/proposals";
import ProposalEditor from "../components/proposals/ProposalEditor";
import { Button } from "../components/ui/button";
import { pageBtnOutlineClass } from "../lib/pageTheme";

export default function ProposalEdit({ createNew = false }) {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const seededProposal = location.state?.proposal;
  const [proposal, setProposal] = useState(() => {
    if (createNew) return normalizeProposal(EMPTY_PROPOSAL);
    if (seededProposal) return normalizeProposal(seededProposal);
    return null;
  });
  const [saveState, setSaveState] = useState(createNew ? "new" : "saved");
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState("");
  const [calendars, setCalendars] = useState([]);
  const idRef = useRef(routeId || seededProposal?.id);
  const hydrated = useRef(createNew || !!seededProposal);
  const editRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        api.get("/calendars").then(({ data }) => {
          if (!cancelled) setCalendars((Array.isArray(data) ? data : data?.items || []).filter((calendar) => calendar.is_active !== false));
        }).catch(() => {});
        if (createNew || (seededProposal && seededProposal.id === routeId)) {
          return;
        }
        const { data } = await api.get(`/proposals/${routeId}`);
        if (!cancelled) {
          setProposal(normalizeProposal(data));
          hydrated.current = true;
        }
      } catch (err) {
        if (!cancelled) setError(formatApiError(err.response?.data?.detail) || "Could not open this proposal.");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [createNew, routeId, seededProposal]);

  useEffect(() => {
    if (!proposal || !hydrated.current) return;
    const revision = editRevision.current;
    if (!revision) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      const snapshot = proposal;
      if (isBlankProposal(snapshot)) {
        if (editRevision.current === revision) setSaveState(snapshot.id ? "saved" : "new");
        return;
      }
      try {
        const { data } = snapshot.id
          ? await api.patch(`/proposals/${snapshot.id}`, serializeProposal(snapshot))
          : await api.post("/proposals", serializeProposal(snapshot, { includeVersion: false }));
        if (editRevision.current === revision) {
          const saved = normalizeProposal(data);
          editRevision.current = 0;
          idRef.current = saved.id || data.id;
          setProposal((current) => ({
            ...current,
            id: saved.id || data.id,
            version: saved.version ?? current.version,
            updated_at: saved.updated_at ?? current.updated_at,
          }));
          setSaveState("saved");
          setError("");
          if (!snapshot.id && idRef.current) {
            navigate(`/proposals/${idRef.current}/edit`, {
              replace: true,
              state: { proposal: { ...saved, id: idRef.current } },
            });
          }
        }
      } catch (err) {
        if (err.response?.status === 409) {
          try {
            const { data } = await api.get(`/proposals/${proposal.id}`);
            const latest = normalizeProposal(data);
            setProposal((current) => ({ ...current, version: latest.version }));
          } catch {}
        }
        if (editRevision.current === revision) {
          setSaveState("error");
          setError(formatApiError(err.response?.data?.detail) || "Could not save this proposal.");
        }
      }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [navigate, proposal]);

  const change = useCallback((next) => {
    editRevision.current += 1;
    setProposal(next);
  }, []);

  const action = async (name, extra = {}) => {
    if (saveState === "saving") {
      setError("Please wait for the current changes to save.");
      return null;
    }
    setActionState(name);
    setError("");
    try {
      const { data } = await api.post(`/proposals/${proposal.id}/${name}`, proposalActionPayload(name, proposal, extra));
      if (name === "duplicate") {
        const duplicate = normalizeProposal(data);
        navigate(`/proposals/${duplicate.id}/edit`, { state: { proposal: duplicate } });
        return duplicate;
      }
      const next = normalizeProposal(data);
      // Preserve share_url from action responses (send / mark-accepted mint a one-time token).
      if (data.share_url) next.share_url = data.share_url;
      setProposal(next);
      editRevision.current = 0;
      return next;
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || `Could not ${name.replace("-", " ")}.`);
      return null;
    } finally {
      setActionState("");
    }
  };

  if (error && !proposal) {
    return (
      <div className="proposal-edit-page grid place-items-center px-6">
        <div className="text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Button className={`${pageBtnOutlineClass} mt-4`} onClick={() => navigate("/proposals")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        </div>
      </div>
    );
  }
  if (!proposal) {
    return (
      <div className="proposal-edit-page grid place-items-center">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading proposal…
        </div>
      </div>
    );
  }

  return (
    <div className="proposal-edit-page overflow-hidden">
      {error && <div className="proposal-edit-error">{error}</div>}
      <ProposalEditor
        proposal={proposal}
        onChange={change}
        saveState={saveState}
        statusLabel={statusLabel(proposal.status)}
        onAction={action}
        actionState={actionState}
        calendars={calendars}
        onBack={() => navigate("/proposals")}
      />
    </div>
  );
}
