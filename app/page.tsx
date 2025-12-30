import styles from "./page.module.css";
import DiscoveryDashboard from "@/components/discovery-dashboard";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.appTitle}>Cubixx Explorer</h1>
        <ThemeToggle />
      </header>
      <section className={styles.content}>
        <DiscoveryDashboard />
      </section>
    </main>
  );
}
