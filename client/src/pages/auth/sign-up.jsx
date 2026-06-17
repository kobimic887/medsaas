import { useState } from "react";
import {
  Input,
  Button,
  Typography,
} from "@material-tailwind/react";
import { Link, useNavigate } from "react-router-dom";
import { API_CONFIG } from "@/utils/constants";
import { useBranding } from "@/hooks/useBranding";
import { useAuth } from "@/context/auth";

export function SignUp() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { brandName, platformName } = useBranding(organization);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!organization.trim()) {
      setError("Company name is required");
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch(API_CONFIG.buildApiUrl('/signup'), {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          email: email.trim(),
          organization: organization.trim()
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");
      setSuccess(true);
      if (data.token && data.user) {
        const loginResult = login(data.user, data.token);
        if (loginResult.success) {
          navigate("/dashboard/controlpanel");
          return;
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="about-us-page m-0 flex min-h-screen bg-slate-50 p-4 dark:bg-slate-950 sm:p-6 md:p-8">
      <div className="hidden h-full w-2/5 lg:block">
        <img
          src="/img/pattern.png"
          alt=""
          className="h-full w-full rounded-3xl object-cover"
        />
      </div>
      <div className="flex w-full flex-col items-center justify-center px-4 py-6 lg:w-3/5">
        <div className="rounded-lg border border-blue-gray-100 bg-white px-4 py-2 capitalize shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-8">
          <span className="cb-auth-logo">ChemBench</span>
        </div>
        <div className="mt-8 max-w-2xl text-center">
          <h1 className="display-3 fw-bold mb-4 text-slate-900 dark:text-slate-50">
            {organization.trim() ? `Set up ${brandName}` : `Create your company on ${platformName}`}
          </h1>
          <p className="lead mb-6 text-blue-gray-700 dark:text-slate-300">
            {organization.trim()
              ? `Register your team workspace for ${brandName}.`
              : "Enter your company name below — that name is used for branding across the app and in emails."}
          </p>
        </div>
        <form
          className="mx-auto mb-2 mt-8 w-80 max-w-screen-lg rounded-lg border border-blue-gray-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/20 lg:w-1/2"
          onSubmit={handleSubmit}
        >
          <div className="mb-1 flex flex-col gap-6">
            <Typography
              variant="small"
              color="blue-gray"
              className="-mb-3 font-medium dark:text-slate-300"
            >
              Your email
            </Typography>
            <Input
              size="lg"
              type="email"
              placeholder="name@mail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="!border-t-blue-gray-200 text-blue-gray-900 focus:!border-t-gray-900 dark:!border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:!border-brand-400"
              labelProps={{
                className: "before:content-none after:content-none",
              }}
            />
            <Typography
              variant="small"
              color="blue-gray"
              className="-mb-3 font-medium dark:text-slate-300"
            >
              Password
            </Typography>
            <Input
              size="lg"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="!border-t-blue-gray-200 text-blue-gray-900 focus:!border-t-gray-900 dark:!border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:!border-brand-400"
              labelProps={{
                className: "before:content-none after:content-none",
              }}
            />
            <Typography
              variant="small"
              color="blue-gray"
              className="-mb-3 font-medium dark:text-slate-300"
            >
              Username
            </Typography>
            <Input
              size="lg"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="!border-t-blue-gray-200 text-blue-gray-900 focus:!border-t-gray-900 dark:!border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:!border-brand-400"
              labelProps={{
                className: "before:content-none after:content-none",
              }}
            />
            <Typography
              variant="small"
              color="blue-gray"
              className="-mb-3 font-medium dark:text-slate-300"
            >
              Company Name
            </Typography>
            <Input
              size="lg"
              placeholder="Company Name"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              className="!border-t-blue-gray-200 text-blue-gray-900 focus:!border-t-gray-900 dark:!border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:!border-brand-400"
              labelProps={{
                className: "before:content-none after:content-none",
              }}
            />
          </div>
          <Button className="mt-6 bg-brand-500 text-white shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/40" fullWidth type="submit" disabled={loading}>
            {loading ? "Registering..." : "Register Now"}
          </Button>
          {error && (
            <Typography color="red" className="mt-2 text-center">
              {error}
            </Typography>
          )}
          {success && (
            <Typography color="green" className="mt-2 text-center">
              {organization.trim()
                ? `${brandName} account created — you can now sign in.`
                : "Signup successful — you can now sign in."}
            </Typography>
          )}
          {/* <div className="space-y-4 mt-8">
            <Button
              size="lg"
              color="white"
              className="flex items-center gap-2 justify-center shadow-md"
              fullWidth
            >
              <svg
                width="17"
                height="16"
                viewBox="0 0 17 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_1156_824)">
                  <path
                    d="M16.3442 8.18429C16.3442 7.64047 16.3001 7.09371 16.206 6.55872H8.66016V9.63937H12.9813C12.802 10.6329 12.2258 11.5119 11.3822 12.0704V14.0693H13.9602C15.4741 12.6759 16.3442 10.6182 16.3442 8.18429Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M8.65974 16.0006C10.8174 16.0006 12.637 15.2922 13.9627 14.0693L11.3847 12.0704C10.6675 12.5584 9.7415 12.8347 8.66268 12.8347C6.5756 12.8347 4.80598 11.4266 4.17104 9.53357H1.51074V11.5942C2.86882 14.2956 5.63494 16.0006 8.65974 16.0006Z"
                    fill="#34A853"
                  />
                  <path
                    d="M4.16852 9.53356C3.83341 8.53999 3.83341 7.46411 4.16852 6.47054V4.40991H1.51116C0.376489 6.67043 0.376489 9.33367 1.51116 11.5942L4.16852 9.53356Z"
                    fill="#FBBC04"
                  />
                  <path
                    d="M8.65974 3.16644C9.80029 3.1488 10.9026 3.57798 11.7286 4.36578L14.0127 2.08174C12.5664 0.72367 10.6469 -0.0229773 8.65974 0.000539111C5.63494 0.000539111 2.86882 1.70548 1.51074 4.40987L4.1681 6.4705C4.8001 4.57449 6.57266 3.16644 8.65974 3.16644Z"
                    fill="#EA4335"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_1156_824">
                    <rect
                      width="16"
                      height="16"
                      fill="white"
                      transform="translate(0.5)"
                    />
                  </clipPath>
                </defs>
              </svg>
              <span>Sign in With Google</span>
            </Button>
            <Button
              size="lg"
              color="white"
              className="flex items-center gap-2 justify-center shadow-md"
              fullWidth
            >
              <img
                src="/img/twitter-logo.svg"
                height={24}
                width={24}
                alt=""
              />
              <span>Sign in With Twitter</span>
            </Button>
          </div> */}
          <Typography
            variant="paragraph"
            className="lead mt-4 text-center font-medium text-blue-gray-500 dark:text-slate-400"
          >
            Already have an account?
            <Link to="/auth/sign-in" className="ml-1 text-gray-900 dark:text-brand-300">
              Sign in
            </Link>
          </Typography>
        </form>
      </div>
    </section>
  );
}

export default SignUp;
