// Page anatomy — see ./README.md before building or restyling a page.
export { PageHeader, DetailHeader, type DetailMetaItem } from "./page-header";
export { PageStack, Reveal, revealVariants, stackVariants } from "./motion";
export { Section, PropertyList, type PropertyItem } from "./section";
export { StatGrid, StatTile, type StatTone } from "./stat-tile";
export {
  Toolbar,
  ToolbarSearch,
  FilterSelect,
  ClearFiltersButton,
  ResultCount,
  ViewToggle,
  type FilterOption,
  type ViewOption,
} from "./toolbar";
export {
  ClickableRow,
  CellLink,
  SortableHead,
  TableEmptyRow,
  TableSkeleton,
  type SortDirection,
  type SkeletonColumn,
  type SkeletonCell,
} from "./data-table";
export { NoResults, SectionSkeleton, DetailSkeleton } from "./states";
export { ErrorPanel } from "./error-panel";
export { DetailLayout, SplitLayout, BoardColumn, BoardColumnEmpty } from "./layout";
export { FormSection, FormRow } from "./form-layout";
export { LinkTabs, type LinkTab } from "./link-tabs";
export { typography } from "./typography";
export { ComingSoon } from "./coming-soon";
