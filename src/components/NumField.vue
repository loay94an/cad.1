<script setup lang="ts">
/**
 * Number input that keeps what you type while you type it ("3." stays "3.")
 * and stores millimetres (or degrees). Accepts a comma as decimal separator.
 */
import { ref, watch } from 'vue';
import type { LengthUnit } from '../model/schema';
import { formatInput, parseLength, parseNumber } from '../units';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue: number;
  kind: LengthUnit | 'deg';
  label?: string;
  /** Emptying the field emits `clear` (go back to the default) instead of setting 0. */
  clearable?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number]; clear: [] }>();

const format = (v: number) => (props.kind === 'deg' ? String(Number(v.toFixed(2))) : formatInput(v, props.kind));
const parse = (t: string) => (props.kind === 'deg' ? parseNumber(t) : parseLength(t, props.kind));

const text = ref(format(props.modelValue));
const invalid = ref(false);
let focused = false;

watch(
  () => [props.modelValue, props.kind] as const,
  () => {
    if (!focused) text.value = format(props.modelValue);
  },
);

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value;
  if (props.clearable && text.value.trim() === '') {
    invalid.value = false;
    emit('clear');
    return;
  }
  const v = parse(text.value);
  invalid.value = !Number.isFinite(v);
  if (!invalid.value) emit('update:modelValue', v);
}

function onFocus(e: FocusEvent) {
  focused = true;
  (e.target as HTMLInputElement).select();
}

function onBlur() {
  focused = false;
  invalid.value = false;
  text.value = format(props.modelValue);
}
</script>

<template>
  <label class="field">
    <span v-if="label" class="field-label">{{ label }}</span>
    <input
      v-bind="$attrs"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :class="{ invalid }"
      :value="text"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
    />
  </label>
</template>
