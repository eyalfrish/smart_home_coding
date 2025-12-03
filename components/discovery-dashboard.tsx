'use client';

import { useState } from "react";
import DiscoveryForm from "./discovery-form";
import DiscoveryResults from "./discovery-results";
import AllPanelsView from "./all-panels-view";
import styles from "./discovery-dashboard.module.css";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
} from "@/lib/discovery/types";

const DEFAULTS: DiscoveryRequest = {
  baseIp: "10.88.99",
  start: 201,
  end: 244,
};

export default function DiscoveryDashboard() {
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<"discovery" | "panels-grid">("discovery");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSubmit = async (payload: DiscoveryRequest) => {
    setIsLoading(true);
    setError(null);
    setView("discovery");
    setSearchQuery("");
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = "Failed to reach discovery service.";
        try {
          const body = await response.json();
          if (body?.message) {
            message = body.message;
          }
        } catch {
          // ignore JSON parse issues here
        }
        throw new Error(message);
      }

      const body = (await response.json()) as DiscoveryResponse;
      setData(body);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected error occurred.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePanelsSummaryClick = () => {
    if (!data || data.summary.panelsFound === 0) {
      return;
    }
    setView("panels-grid");
  };

  const handleBackToDiscovery = () => {
    setView("discovery");
  };

  const panelResults = data?.results ?? [];

  return (
    <div className={styles.card}>
      {view === "panels-grid" ? (
        <AllPanelsView
          panels={panelResults}
          onBack={handleBackToDiscovery}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      ) : (
        <>
          <DiscoveryForm
            defaults={DEFAULTS}
            disabled={isLoading}
            isLoading={isLoading}
            onSubmit={handleSubmit}
          />
          {error && <div className={styles.errorBox}>{error}</div>}
          <DiscoveryResults
            data={data}
            onPanelsSummaryClick={handlePanelsSummaryClick}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </>
      )}
    </div>
  );
}

