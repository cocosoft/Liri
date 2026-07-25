import { useTheme } from "../../hooks/useTheme";
import { DataSourcePage } from "../Knowledge/DataSource/DataSourcePage";

export function DataSourceView() {
  const { isDark } = useTheme();
  return <DataSourcePage isDark={isDark} />;
}
