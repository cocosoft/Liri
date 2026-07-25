import { useTheme } from "../../hooks/useTheme";
import { DataSourcePage } from "../Knowledge/DataSource/DataSourcePage";

export function DataSourceView() {
  const theme = useTheme();
  const isDark = theme === "dark";
  return <DataSourcePage isDark={isDark} />;
}

export default DataSourceView;
