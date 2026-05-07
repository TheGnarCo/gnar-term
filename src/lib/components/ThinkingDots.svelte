<script lang="ts">
  export let color: string;
  export let size: number = 4;
  export let label: string = "thinking";
</script>

<span
  class="dots"
  role="img"
  aria-label={label}
  style="--dot-color: {color}; --dot-size: {size}px;"
>
  <span class="dot"></span>
  <span class="dot"></span>
  <span class="dot"></span>
</span>

<style>
  .dots {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .dot {
    width: var(--dot-size);
    height: var(--dot-size);
    border-radius: 50%;
    background: var(--dot-color);
    animation: wave 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dot:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes wave {
    0%,
    60%,
    100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-1.5px);
    }
  }
</style>
