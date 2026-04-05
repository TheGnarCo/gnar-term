<script lang="ts">
  import { theme } from "../stores/theme";
</script>

<div
  data-tauri-drag-region=""
  style="
    height: 38px; flex-shrink: 0; display: flex; align-items: center;
    padding-left: 16px; -webkit-app-region: drag;
    background: {$theme.bg}; border-bottom: 1px solid {$theme.border};
  "
>
  <span style="
    font-size: 11px; font-weight: 600; letter-spacing: 1.5px;
    color: {$theme.fgDim}; pointer-events: none;
  ">GNARTERM</span>
</div>
