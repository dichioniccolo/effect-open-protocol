/**
 * A CSS custom property name, such as the `--gap` a component hands to its
 * Tailwind classes.
 */
export type CustomProperty = `--${string}`

/** Lets `style` carry custom properties without casting the whole object. */
declare module "react" {
  interface CSSProperties {
    [property: CustomProperty]: string | number | undefined
  }
}
