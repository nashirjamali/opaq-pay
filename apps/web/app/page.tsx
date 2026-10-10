import { redirect } from "next/navigation";

// Product first: there is no landing page, the demo is the front door.
export default function Home() {
  redirect("/overview");
}
