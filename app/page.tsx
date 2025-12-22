import styles from "./page.module.css";
import DiscoveryDashboard from "@/components/discovery-dashboard";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.appIcon}>🏠</span>
          <span className={styles.appTitle}>Cubixx Devices</span>
        </div>
        <ThemeToggle />
      </header>
      <section className={styles.hero}>
        <h1>Cubixx Panel Explorer</h1>
        <p>
          Scan LAN ranges, pinpoint genuine Cubixx panels, preview their live
          UI, and jump straight into management from one dashboard.
        </p>
      </section>
      <section className={styles.content}>
        <DiscoveryDashboard />
      </section>
    </main>
  );
}
