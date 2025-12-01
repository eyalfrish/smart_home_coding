import styles from "./page.module.css";
import DiscoveryDashboard from "@/components/discovery-dashboard";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1>Smart Lighting Discovery</h1>
        <p>
          Scan a range of LAN IPs, discover which addresses host smart switch
          panels, and review their status in seconds.
        </p>
      </section>
      <section className={styles.content}>
        <DiscoveryDashboard />
      </section>
    </main>
  );
}

