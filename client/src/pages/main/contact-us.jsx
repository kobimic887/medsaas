import { useEffect, useRef, useState } from "react";

const CONTACT_FETCH_TIMEOUT_MS = 15_000;

export default function ContactUs() {
  const [form, setForm] = useState({
    name: "",
    recipientEmail: "",
    subject: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestControllerRef = useRef(null);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.recipientEmail || !form.subject || !form.message) {
      setError("All fields are required.");
      return;
    }
    
    // Email validation for recipient
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.recipientEmail)) {
      setError("Please enter a valid recipient email address.");
      return;
    }

    setError("");
    setLoading(true);
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CONTACT_FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const result = await response.json().catch(() => null);

      if (response.ok && result?.success) {
        setSubmitted(true);
        setForm({
          name: "",
          recipientEmail: "",
          subject: "",
          message: "",
        });
      } else {
        setError(result?.error || `Message could not be sent (HTTP ${response.status}). Please try again.`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (timedOut) setError('Request timed out. Please try again.');
        return;
      }
      console.error('Error sending email:', error);
      setError('Failed to send email. Please check your connection and try again.');
    } finally {
      window.clearTimeout(timeoutId);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 font-sans sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-blue-gray-900 dark:text-slate-50">Contact Pyxis Discovery</h1>
      <p className="mt-3 text-base leading-7 text-blue-gray-700 dark:text-slate-300">
        Tell our team how we can help with registration, partnerships, or technical support.
      </p>
      <div className="mt-6 rounded-xl border border-blue-gray-100 bg-blue-gray-50 p-4 text-sm text-blue-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <p>
          Prefer email?{" "}
          <a
            href="mailto:contact@pyxis-discovery.com"
            className="font-medium text-blue-700 underline underline-offset-2 dark:text-brand-300"
          >
            contact@pyxis-discovery.com
          </a>
        </p>
      </div>
      {submitted ? (
        <div className="mt-8 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200" role="status">
          Thank you for contacting us! We will get back to you soon.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="contact-name" className="mb-2 block text-sm font-medium text-blue-gray-800 dark:text-slate-200">Your name</label>
            <input
              id="contact-name"
              type="text"
              name="name"
              autoComplete="name"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-blue-gray-200 bg-white px-3 py-2.5 text-blue-gray-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="mb-2 block text-sm font-medium text-blue-gray-800 dark:text-slate-200">Your email</label>
            <input
              id="contact-email"
              type="email"
              name="recipientEmail"
              autoComplete="email"
              value={form.recipientEmail}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-blue-gray-200 bg-white px-3 py-2.5 text-blue-gray-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="contact-subject" className="mb-2 block text-sm font-medium text-blue-gray-800 dark:text-slate-200">Subject</label>
            <input
              id="contact-subject"
              type="text"
              name="subject"
              value={form.subject}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-blue-gray-200 bg-white px-3 py-2.5 text-blue-gray-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="contact-message" className="mb-2 block text-sm font-medium text-blue-gray-800 dark:text-slate-200">Message</label>
            <textarea
              id="contact-message"
              name="message"
              value={form.message}
              onChange={handleChange}
              required
              rows={5}
              className="w-full resize-y rounded-lg border border-blue-gray-200 bg-white px-3 py-2.5 text-blue-gray-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="alert">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-500 px-4 py-3 text-base font-semibold text-white transition hover:bg-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send message"}
          </button>
        </form>
      )}
    </div>
  );
}
