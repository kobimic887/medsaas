import React, { useState } from "react";
import { Button, Typography } from "@material-tailwind/react";

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
    
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const result = await response.json();

      if (result.success) {
        setSubmitted(true);
        setForm({
          name: "",
          recipientEmail: "",
          subject: "",
          message: "",
        });
      } else {
        setError(result.error || 'Failed to send email. Please try again.');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      setError('Failed to send email. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-8 font-sans">
      <h1 className="display-3 fw-bold mb-4">Email Client</h1>
      <p className="lead mb-6 text-blue-gray-700">
        Send an email directly to any recipient using our email service.
      </p>
      <div className="mb-6">
        <p className="fw-bold mb-1">Pyxis Discovery</p>
        <p className="mb-0">
          Matrix Innovation Center
          <br />
          Science Park 408
          <br />
          1098XH Amsterdam
          <br />
          The Netherlands
        </p>
        <p className="mt-2 mb-0">
          Email:{" "}
          <a
            href="mailto:info@pyxis-discovery.com"
            className="text-blue-600 underline"
          >
            info@pyxis-discovery.com
          </a>
        </p>
      </div>
      {submitted ? (
        <div className="bg-green-100 text-green-800 p-4 rounded mb-4">
          Thank you for contacting us! We will get back to you soon.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="text"
              name="name"
              placeholder="Your Name *"
              value={form.name}
              onChange={handleChange}
              required
              className="form-control form-control-lg"
            />
          </div>
          <div>
            <input
              type="email"
              name="recipientEmail"
              placeholder="Send to Email *"
              value={form.recipientEmail}
              onChange={handleChange}
              required
              className="form-control form-control-lg"
            />
          </div>
          <div>
            <input
              type="text"
              name="subject"
              placeholder="Subject *"
              value={form.subject}
              onChange={handleChange}
              required
              className="form-control form-control-lg"
            />
          </div>
          <div>
            <textarea
              name="message"
              placeholder="Message *"
              value={form.message}
              onChange={handleChange}
              required
              rows={5}
              className="form-control form-control-lg resize-none"
            />
          </div>
          {error && <div className="text-danger text-sm">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-success w-100 fw-bold py-2 text-lg"
          >
            {loading ? "Sending..." : "Send Email"}
          </button>
        </form>
      )}
    </div>
  );
}
