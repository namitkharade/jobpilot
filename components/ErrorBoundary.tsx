"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Something went wrong",
    };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught error:", error);
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-4 my-6 rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <h2 className="text-lg font-semibold">Request failed</h2>
          <p className="mt-2 text-sm">{this.state.message}</p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-4 rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-medium hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
