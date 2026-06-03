export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: string;
  card: string;
}

export interface ThemeToken {
  color: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    background: {
      primary: string;
      secondary: string;
      tertiary: string;
      elevated: string;
    };
    text: {
      primary: string;
      secondary: string;
      tertiary: string;
      disabled: string;
    };
    border: {
      default: string;
      hover: string;
      active: string;
    };
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
  };
  radius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
    full: string;
  };
  shadow: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  tokens: ThemeToken;
}
