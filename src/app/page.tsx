import { AppRoot } from "@/components/app/app-root";
import { Providers } from "@/components/app/providers";

export default function Home() {
  return (
    <Providers>
      <AppRoot />
    </Providers>
  );
}
