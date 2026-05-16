import React from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Progress,
  Spinner,
  Typography,
} from "@material-tailwind/react";
import {
  ArrowPathIcon,
  ChartBarIcon,
  CheckIcon,
  ClipboardDocumentListIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { API_CONFIG, getAuthToken } from "@/utils/constants";
import { buildLigandUploadPayload, MAX_LIGAND_FILE_SIZE_BYTES } from "@/utils/ligandUpload";

const initialInviteForm = {
  username: "",
  email: "",
  role: "member",
  password: "",
};

const tabs = [
  { key: "members", label: "Members", icon: UsersIcon },
  { key: "usage", label: "Usage", icon: ChartBarIcon },
  { key: "audit", label: "Audit", icon: ClipboardDocumentListIcon },
];

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString();
}

function normalizeMemberDraft(member) {
  return {
    role: member.role || "member",
    active: member.active !== false,
    simulationTokens: String(Number.isFinite(Number(member.simulationTokens)) ? member.simulationTokens : 0),
  };
}

function roleChipColor(role) {
  if (role === "owner") return "amber";
  if (role === "admin") return "blue";
  return "gray";
}

function statusChipColor(status) {
  if (status === "success") return "green";
  if (status === "error") return "red";
  return "gray";
}

function actionLabel(action) {
  return String(action || "event").replace(/\./g, " ");
}

function auditSummary(details = {}) {
  const parts = [];
  if (details.pdbid) parts.push(`PDB ${details.pdbid}`);
  if (details.smiles) parts.push(`SMILES ${details.smiles}`);
  if (details.mode) parts.push(details.mode);
  if (details.role) parts.push(`role ${details.role}`);
  if (details.updates) parts.push(`updates ${Object.keys(details.updates).join(", ")}`);
  if (details.name) parts.push(details.name);
  if (details.error) parts.push(details.error);
  return parts.length ? parts.join(" | ") : "N/A";
}

async function companyRequest(endpoint, options = {}) {
  const token = getAuthToken();
  const response = await fetch(API_CONFIG.buildApiUrl(endpoint), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : {};
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

export function CompanyAdmin() {
  const [activeTab, setActiveTab] = React.useState("members");
  const [usageData, setUsageData] = React.useState(null);
  const [auditLogs, setAuditLogs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState("");
  const [message, setMessage] = React.useState(null);
  const [inviteForm, setInviteForm] = React.useState(initialInviteForm);
  const [temporaryPassword, setTemporaryPassword] = React.useState("");
  const [ligandFile, setLigandFile] = React.useState(null);
  const [ligandInputKey, setLigandInputKey] = React.useState(0);
  const [memberDrafts, setMemberDrafts] = React.useState({});
  const [policyForm, setPolicyForm] = React.useState({
    monthlySimulationCap: "",
    defaultSimulationTokensPerUser: "50",
  });
  const [applyTokensToMembers, setApplyTokensToMembers] = React.useState(false);
  const [auditFilters, setAuditFilters] = React.useState({
    action: "",
    status: "",
    limit: "100",
  });

  const showMessage = (type, text) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 5000);
  };

  const loadUsage = React.useCallback(async () => {
    const data = await companyRequest("/company/usage");
    setUsageData(data);
    const usagePolicy = data.usagePolicy || {};
    setPolicyForm({
      monthlySimulationCap: usagePolicy.monthlySimulationCap ?? "",
      defaultSimulationTokensPerUser: String(usagePolicy.defaultSimulationTokensPerUser ?? 50),
    });
    const drafts = {};
    (data.members || []).forEach((member) => {
      drafts[member.username] = normalizeMemberDraft(member);
    });
    setMemberDrafts(drafts);
  }, []);

  const loadAudit = React.useCallback(async () => {
    const params = new URLSearchParams();
    if (auditFilters.action.trim()) params.set("action", auditFilters.action.trim());
    if (auditFilters.status) params.set("status", auditFilters.status);
    if (auditFilters.limit) params.set("limit", auditFilters.limit);
    const data = await companyRequest(`/company/audit-logs?${params.toString()}`);
    setAuditLogs(data.logs || []);
  }, [auditFilters]);

  const refreshAll = React.useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setLoading(false);
    }
  }, [loadAudit, loadUsage]);

  React.useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const updateInviteForm = (field, value) => {
    setInviteForm((current) => ({ ...current, [field]: value }));
  };

  const updateMemberDraft = (username, field, value) => {
    setMemberDrafts((current) => ({
      ...current,
      [username]: {
        ...current[username],
        [field]: value,
      },
    }));
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    setSaving("invite");
    setTemporaryPassword("");
    try {
      const payload = {
        username: inviteForm.username.trim(),
        email: inviteForm.email.trim(),
        role: inviteForm.role,
      };
      if (inviteForm.password.trim()) payload.password = inviteForm.password.trim();
      const result = await companyRequest("/company/members", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setInviteForm(initialInviteForm);
      if (result.temporaryPassword) setTemporaryPassword(result.temporaryPassword);
      showMessage("green", `${result.message || "Member invited"}${result.inviteEmailSent ? " Invite email sent." : ""}`);
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setSaving("");
    }
  };

  const handleMemberSave = async (member) => {
    const draft = memberDrafts[member.username];
    if (!draft) return;

    const updates = {};
    if (member.role !== "owner" && draft.role !== (member.role || "member")) {
      updates.role = draft.role;
    }

    const nextTokens = Number(draft.simulationTokens);
    const currentTokens = Number.isFinite(Number(member.simulationTokens)) ? Number(member.simulationTokens) : 0;
    if (Number.isFinite(nextTokens) && Math.floor(nextTokens) !== currentTokens) {
      updates.simulationTokens = Math.floor(nextTokens);
    }

    if (Object.keys(updates).length === 0) {
      showMessage("blue", "No member changes to save");
      return;
    }

    setSaving(`member-${member.username}`);
    try {
      await companyRequest(`/company/members/${encodeURIComponent(member.username)}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      showMessage("green", "Member updated");
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setSaving("");
    }
  };

  const handleMemberActive = async (member, active) => {
    setSaving(`active-${member.username}`);
    try {
      await companyRequest(`/company/members/${encodeURIComponent(member.username)}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      showMessage("green", active ? "Member enabled" : "Member disabled");
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setSaving("");
    }
  };

  const handleRemoveMember = async (member) => {
    const confirmed = window.confirm(`Remove ${member.username} from the company?`);
    if (!confirmed) return;
    setSaving(`remove-${member.username}`);
    try {
      await companyRequest(`/company/members/${encodeURIComponent(member.username)}`, {
        method: "DELETE",
      });
      showMessage("green", "Member removed");
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setSaving("");
    }
  };

  const handleUsagePolicySave = async (event) => {
    event.preventDefault();
    setSaving("usage-policy");
    try {
      const capValue = policyForm.monthlySimulationCap === ""
        ? null
        : Number(policyForm.monthlySimulationCap);
      const defaultTokens = Number(policyForm.defaultSimulationTokensPerUser);
      const payload = {
        monthlySimulationCap: capValue,
        defaultSimulationTokensPerUser: defaultTokens,
        applyDefaultTokensToAllMembers: applyTokensToMembers,
      };
      const result = await companyRequest("/company/usage-policy", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setApplyTokensToMembers(false);
      showMessage("green", result.message || "Usage policy updated");
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setSaving("");
    }
  };

  const handleLigandUpload = async (event) => {
    event.preventDefault();
    if (!ligandFile) {
      showMessage("red", "Choose a ligand file to upload");
      return;
    }
    if (ligandFile.size > MAX_LIGAND_FILE_SIZE_BYTES) {
      showMessage("red", "Ligand file must be 2MB or smaller");
      return;
    }
    setSaving("ligand-upload");
    try {
      const ligandUpload = await buildLigandUploadPayload(ligandFile);
      const result = await companyRequest("/company/ligand-upload", {
        method: "PATCH",
        body: JSON.stringify({ ligandUpload }),
      });
      showMessage("green", result.message || "Ligand file uploaded");
      setLigandFile(null);
      setLigandInputKey((value) => value + 1);
      await Promise.all([loadUsage(), loadAudit()]);
    } catch (error) {
      showMessage("red", error.message);
    } finally {
      setSaving("");
    }
  };

  const company = usageData?.company;
  const usage = usageData?.usage || {};
  const members = usageData?.members || [];
  const monthlyCap = usage.monthlySimulationCap;
  const monthlyPercent = usage.monthlyUsagePercent ?? 0;

  const statCards = [
    { label: "Monthly runs", value: formatNumber(usage.simulationsRun), sub: usage.monthKey || "Current month" },
    { label: "Monthly cap", value: monthlyCap === null || monthlyCap === undefined ? "Unlimited" : formatNumber(monthlyCap), sub: monthlyCap ? `${formatNumber(usage.monthlyRemaining)} remaining` : "No cap set" },
    { label: "Active members", value: formatNumber(usage.activeMembers), sub: `${formatNumber(usage.totalMembers)} total` },
    { label: "Tokens left", value: formatNumber(usage.totalTokensRemaining), sub: "Across active members" },
  ];

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <Typography variant="h3" color="blue-gray">
            Company Admin
          </Typography>
          <Typography variant="small" className="mt-1 font-normal text-blue-gray-600">
            {company?.name || "Company workspace"}
          </Typography>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-blue-gray-100 bg-white p-1">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex min-h-[40px] items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                  activeTab === key
                    ? "bg-[#b4b239] text-white"
                    : "text-blue-gray-700 hover:bg-blue-gray-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <Button
            variant="outlined"
            size="sm"
            className="flex items-center gap-2"
            onClick={refreshAll}
            disabled={loading}
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <Alert color={message.type} className="text-sm">
          {message.text}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Spinner className="h-6 w-6" />
          <Typography variant="small" color="gray">
            Loading company data...
          </Typography>
        </div>
      ) : (
        <>
          {activeTab === "members" && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
              <Card className="border border-blue-gray-100 shadow-sm">
                <CardHeader floated={false} shadow={false} className="rounded-none">
                  <div className="flex items-center gap-3">
                    <UserPlusIcon className="h-6 w-6 text-[#8c8a22]" />
                    <div>
                      <Typography variant="h5" color="blue-gray">
                        Invite Member
                      </Typography>
                      <Typography variant="small" color="gray" className="font-normal">
                        {company?.name || "Company"}
                      </Typography>
                    </div>
                  </div>
                </CardHeader>
                <CardBody>
                  <form className="space-y-4" onSubmit={handleInvite}>
                    <Input
                      label="Username"
                      value={inviteForm.username}
                      onChange={(event) => updateInviteForm("username", event.target.value)}
                      required
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={inviteForm.email}
                      onChange={(event) => updateInviteForm("email", event.target.value)}
                      required
                    />
                    <div>
                      <Typography variant="small" className="mb-2 font-medium text-blue-gray-700">
                        Role
                      </Typography>
                      <select
                        className="h-11 w-full rounded-md border border-blue-gray-200 bg-white px-3 text-sm text-blue-gray-700 outline-none focus:border-gray-900"
                        value={inviteForm.role}
                        onChange={(event) => updateInviteForm("role", event.target.value)}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <Input
                      label="Initial password"
                      type="password"
                      value={inviteForm.password}
                      onChange={(event) => updateInviteForm("password", event.target.value)}
                    />
                    <Button
                      type="submit"
                      className="flex items-center justify-center gap-2"
                      fullWidth
                      disabled={saving === "invite"}
                    >
                      {saving === "invite" ? <Spinner className="h-4 w-4" /> : <UserPlusIcon className="h-4 w-4" />}
                      Invite
                    </Button>
                  </form>
                  {temporaryPassword && (
                    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                      <Typography variant="small" className="font-medium text-amber-900">
                        Temporary password
                      </Typography>
                      <Typography className="mt-1 break-all font-mono text-sm text-amber-900">
                        {temporaryPassword}
                      </Typography>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card className="border border-blue-gray-100 shadow-sm">
                <CardHeader floated={false} shadow={false} className="rounded-none">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Typography variant="h5" color="blue-gray">
                        Team Members
                      </Typography>
                      <Typography variant="small" color="gray" className="font-normal">
                        {formatNumber(members.length)} accounts
                      </Typography>
                    </div>
                  </div>
                </CardHeader>
                <CardBody className="overflow-x-auto px-0 pt-0">
                  <table className="w-full min-w-[860px] table-auto">
                    <thead>
                      <tr>
                        {["User", "Role", "Tokens", "Status", "Created", "Actions"].map((header) => (
                          <th key={header} className="border-b border-blue-gray-50 px-5 py-3 text-left">
                            <Typography variant="small" className="font-semibold uppercase text-blue-gray-500">
                              {header}
                            </Typography>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => {
                        const draft = memberDrafts[member.username] || normalizeMemberDraft(member);
                        const isOwner = member.role === "owner";
                        const isSelfLocked = isOwner;
                        return (
                          <tr key={member.username} className="border-b border-blue-gray-50">
                            <td className="px-5 py-4">
                              <Typography variant="small" color="blue-gray" className="font-semibold">
                                {member.username}
                              </Typography>
                              <Typography variant="small" color="gray" className="font-normal">
                                {member.email}
                              </Typography>
                            </td>
                            <td className="px-5 py-4">
                              {isOwner ? (
                                <Chip value="owner" color="amber" size="sm" className="w-fit" />
                              ) : (
                                <select
                                  className="h-10 w-32 rounded-md border border-blue-gray-200 bg-white px-2 text-sm text-blue-gray-700 outline-none focus:border-gray-900"
                                  value={draft.role}
                                  onChange={(event) => updateMemberDraft(member.username, "role", event.target.value)}
                                >
                                  <option value="member">Member</option>
                                  <option value="admin">Admin</option>
                                </select>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              <input
                                type="number"
                                min="0"
                                className="h-10 w-24 rounded-md border border-blue-gray-200 px-2 text-sm text-blue-gray-700 outline-none focus:border-gray-900"
                                value={draft.simulationTokens}
                                onChange={(event) => updateMemberDraft(member.username, "simulationTokens", event.target.value)}
                              />
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col gap-2">
                                <Chip
                                  value={member.active === false ? "disabled" : "active"}
                                  color={member.active === false ? "red" : "green"}
                                  size="sm"
                                  className="w-fit"
                                />
                                <Chip value={member.role || "member"} color={roleChipColor(member.role)} size="sm" className="w-fit" />
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <Typography variant="small" color="gray">
                                {formatDate(member.createdAt)}
                              </Typography>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outlined"
                                  className="flex items-center gap-2"
                                  onClick={() => handleMemberSave(member)}
                                  disabled={saving === `member-${member.username}`}
                                >
                                  {saving === `member-${member.username}` ? <Spinner className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
                                  Save
                                </Button>
                                {!isSelfLocked && (
                                  <Button
                                    size="sm"
                                    variant="text"
                                    color={member.active === false ? "green" : "amber"}
                                    onClick={() => handleMemberActive(member, member.active === false)}
                                    disabled={saving === `active-${member.username}`}
                                  >
                                    {member.active === false ? "Enable" : "Disable"}
                                  </Button>
                                )}
                                {!isSelfLocked && (
                                  <Button
                                    size="sm"
                                    variant="text"
                                    color="red"
                                    className="flex items-center gap-2"
                                    onClick={() => handleRemoveMember(member)}
                                    disabled={saving === `remove-${member.username}`}
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                    Remove
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardBody>
              </Card>

              <Card className="border border-blue-gray-100 shadow-sm">
                <CardHeader floated={false} shadow={false} className="rounded-none">
                  <Typography variant="h5" color="blue-gray">
                    Company Ligand Upload
                  </Typography>
                </CardHeader>
                <CardBody>
                  <div className="mb-4 rounded-md border border-blue-gray-100 bg-blue-gray-50/40 p-3">
                    <Typography variant="small" color="blue-gray" className="font-medium">
                      Current ligand file
                    </Typography>
                    <Typography variant="small" color="gray" className="mt-1">
                      {company?.ligandUpload?.fileName || "No ligand file uploaded"}
                    </Typography>
                    {company?.ligandUpload?.uploadedAt && (
                      <Typography variant="small" color="gray" className="mt-1">
                        Uploaded: {formatDate(company.ligandUpload.uploadedAt)}
                      </Typography>
                    )}
                    {company?.ligandUpload?.sizeBytes !== undefined && (
                      <Typography variant="small" color="gray" className="mt-1">
                        Size: {formatNumber(company.ligandUpload.sizeBytes)} bytes
                      </Typography>
                    )}
                  </div>

                  <form className="space-y-4" onSubmit={handleLigandUpload}>
                    <input
                      key={ligandInputKey}
                      type="file"
                      accept=".sdf,.mol,.mol2,.csv,.txt,.json"
                      className="w-full rounded-md border border-blue-gray-200 px-3 py-2 text-sm text-blue-gray-700"
                      onChange={(event) => setLigandFile(event.target.files?.[0] || null)}
                      required
                    />
                    <Typography variant="small" color="gray">
                      Accepted formats: SDF, MOL, MOL2, CSV, TXT, JSON (max 2MB)
                    </Typography>
                    <Button
                      type="submit"
                      className="flex items-center justify-center gap-2"
                      disabled={saving === "ligand-upload"}
                    >
                      {saving === "ligand-upload" ? <Spinner className="h-4 w-4" /> : <ArrowPathIcon className="h-4 w-4" />}
                      Upload Ligand
                    </Button>
                  </form>
                </CardBody>
              </Card>
            </div>
          )}

          {activeTab === "usage" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                {statCards.map((stat) => (
                  <Card key={stat.label} className="border border-blue-gray-100 shadow-sm">
                    <CardBody>
                      <Typography variant="small" className="font-medium uppercase text-blue-gray-500">
                        {stat.label}
                      </Typography>
                      <Typography variant="h4" color="blue-gray" className="mt-2">
                        {stat.value}
                      </Typography>
                      <Typography variant="small" color="gray" className="mt-1 font-normal">
                        {stat.sub}
                      </Typography>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <Card className="border border-blue-gray-100 shadow-sm">
                <CardHeader floated={false} shadow={false} className="rounded-none">
                  <Typography variant="h5" color="blue-gray">
                    Monthly Simulation Usage
                  </Typography>
                </CardHeader>
                <CardBody>
                  <div className="mb-6">
                    <div className="mb-2 flex items-center justify-between">
                      <Typography variant="small" color="blue-gray" className="font-medium">
                        {formatNumber(usage.simulationsRun)} runs
                      </Typography>
                      <Typography variant="small" color="blue-gray" className="font-medium">
                        {monthlyCap ? `${monthlyPercent}%` : "Unlimited"}
                      </Typography>
                    </div>
                    <Progress value={monthlyCap ? monthlyPercent : 0} color={monthlyPercent > 90 ? "red" : "green"} />
                  </div>

                  <form className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_auto] xl:items-end" onSubmit={handleUsagePolicySave}>
                    <Input
                      label="Monthly simulation cap"
                      type="number"
                      min="1"
                      value={policyForm.monthlySimulationCap}
                      onChange={(event) => setPolicyForm((current) => ({ ...current, monthlySimulationCap: event.target.value }))}
                    />
                    <Input
                      label="Default user tokens"
                      type="number"
                      min="0"
                      value={policyForm.defaultSimulationTokensPerUser}
                      onChange={(event) => setPolicyForm((current) => ({ ...current, defaultSimulationTokensPerUser: event.target.value }))}
                    />
                    <Button
                      type="submit"
                      className="flex h-11 items-center justify-center gap-2"
                      disabled={saving === "usage-policy"}
                    >
                      {saving === "usage-policy" ? <Spinner className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
                      Save Policy
                    </Button>
                    <label className="flex items-center gap-3 xl:col-span-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={applyTokensToMembers}
                        onChange={(event) => setApplyTokensToMembers(event.target.checked)}
                      />
                      <Typography variant="small" color="blue-gray">
                        Apply default tokens to all active members
                      </Typography>
                    </label>
                  </form>
                </CardBody>
              </Card>
            </div>
          )}

          {activeTab === "audit" && (
            <Card className="border border-blue-gray-100 shadow-sm">
              <CardHeader floated={false} shadow={false} className="rounded-none">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <Typography variant="h5" color="blue-gray">
                      Audit Log
                    </Typography>
                    <Typography variant="small" color="gray" className="font-normal">
                      {formatNumber(auditLogs.length)} events
                    </Typography>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <Input
                      label="Action"
                      value={auditFilters.action}
                      onChange={(event) => setAuditFilters((current) => ({ ...current, action: event.target.value }))}
                    />
                    <select
                      className="h-11 rounded-md border border-blue-gray-200 bg-white px-3 text-sm text-blue-gray-700 outline-none focus:border-gray-900"
                      value={auditFilters.status}
                      onChange={(event) => setAuditFilters((current) => ({ ...current, status: event.target.value }))}
                    >
                      <option value="">All statuses</option>
                      <option value="success">Success</option>
                      <option value="error">Error</option>
                    </select>
                    <Input
                      label="Limit"
                      type="number"
                      min="1"
                      max="500"
                      value={auditFilters.limit}
                      onChange={(event) => setAuditFilters((current) => ({ ...current, limit: event.target.value }))}
                    />
                    <Button
                      variant="outlined"
                      className="flex h-11 items-center justify-center gap-2"
                      onClick={loadAudit}
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      Filter
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardBody className="overflow-x-auto px-0 pt-0">
                <table className="w-full min-w-[980px] table-auto">
                  <thead>
                    <tr>
                      {["Time", "Actor", "Action", "Target", "Status", "Company", "Details"].map((header) => (
                        <th key={header} className="border-b border-blue-gray-50 px-5 py-3 text-left">
                          <Typography variant="small" className="font-semibold uppercase text-blue-gray-500">
                            {header}
                          </Typography>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log._id} className="border-b border-blue-gray-50 align-top">
                        <td className="px-5 py-4">
                          <Typography variant="small" color="gray">
                            {formatDate(log.timestamp)}
                          </Typography>
                        </td>
                        <td className="px-5 py-4">
                          <Typography variant="small" color="blue-gray" className="font-semibold">
                            {log.actorUsername || "System"}
                          </Typography>
                          <Typography variant="small" color="gray" className="font-normal">
                            {log.actorRole || "N/A"}
                          </Typography>
                        </td>
                        <td className="px-5 py-4">
                          <Typography variant="small" color="blue-gray" className="capitalize">
                            {actionLabel(log.action)}
                          </Typography>
                        </td>
                        <td className="px-5 py-4">
                          <Typography variant="small" color="blue-gray">
                            {log.targetType || "N/A"}
                          </Typography>
                          <Typography variant="small" color="gray" className="font-mono">
                            {log.targetId || "N/A"}
                          </Typography>
                        </td>
                        <td className="px-5 py-4">
                          <Chip
                            value={log.status || "success"}
                            color={statusChipColor(log.status)}
                            size="sm"
                            className="w-fit"
                          />
                        </td>
                        <td className="px-5 py-4">
                          <Typography variant="small" color="blue-gray">
                            {log.companyName || company?.name || "N/A"}
                          </Typography>
                        </td>
                        <td className="max-w-[320px] px-5 py-4">
                          <Typography variant="small" color="gray" className="break-words">
                            {auditSummary(log.details)}
                          </Typography>
                        </td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center">
                          <Typography variant="small" color="gray">
                            No audit events found
                          </Typography>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default CompanyAdmin;
