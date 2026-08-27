import { createContext, useContext, useEffect, useReducer } from 'react';

// Only the profile card (name/WA/address/patokan) persists long-term — cart,
// step, tanggal pemesanan, promo, and shipping are intentionally NOT
// persisted, they reset on every refresh like before.
const PROFILE_STORAGE_KEY = 'ordi_customer_profile_v1';

const initialState = {
  step: 1,
  orderType: null,        // 'pickup' | 'delivery'
  selectedDate: null,
  selectedDateLabel: null,
  cart: {},                // key -> { product, qty, variantLabels?, extraPrice? }
  activePromo: null,
  selectedShipping: null,  // { price, label } | null
  profile: { name: '', wa: '', address: '', addressNote: '', lat: null, lng: null },
  isProfileFilled: false,
  note: '',
  // Shipping calc result — displayed by OngkirOptions, set by useShipping (triggered
  // once from ProfileModal's save handler, or once from CheckoutStep's mount
  // effect for a returning customer's saved address — never on every address
  // keystroke or on every render).
  shippingStatus: 'idle',   // 'idle' | 'loading' | 'options' | 'static' | 'unavailable'
  shippingOptions: [],       // Biteship courier options, when shippingStatus === 'options'
  shippingStaticKm: null,    // distance in km, when shippingStatus === 'static' | 'unavailable'
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step };

    case 'SELECT_ORDER_TYPE':
      return { ...state, orderType: action.orderType };

    case 'SET_DATE':
      return { ...state, selectedDate: action.value, selectedDateLabel: action.label };

    case 'ADD_TO_CART': {
      const { key, product, qty, variantLabels, extraPrice } = action;
      const existing = state.cart[key];
      return {
        ...state,
        cart: {
          ...state.cart,
          [key]: existing
            ? { ...existing, qty: existing.qty + qty }
            : { product, qty, variantLabels, extraPrice },
        },
      };
    }

    case 'SET_CART_QTY': {
      const { key, product, qty } = action;
      const nextCart = { ...state.cart };
      if (qty <= 0) delete nextCart[key];
      else nextCart[key] = { product, qty };
      return { ...state, cart: nextCart };
    }

    case 'REMOVE_CART_ITEM': {
      const nextCart = { ...state.cart };
      delete nextCart[action.key];
      return { ...state, cart: nextCart };
    }

    case 'APPLY_PROMO':
      return { ...state, activePromo: action.promo };

    case 'REMOVE_PROMO':
      return { ...state, activePromo: null };

    case 'CLEAR_SHIPPING':
      return {
        ...state,
        selectedShipping: null,
        shippingStatus: 'idle',
        shippingOptions: [],
        shippingStaticKm: null,
      };

    case 'SET_SHIPPING':
      return { ...state, selectedShipping: action.shipping };

    case 'SET_SHIPPING_LOADING':
      return { ...state, shippingStatus: 'loading' };

    case 'SET_SHIPPING_OPTIONS': {
      const options = action.options;
      return {
        ...state,
        shippingStatus: 'options',
        shippingOptions: options,
        selectedShipping: options[0]
          ? { price: options[0].price, label: `${options[0].courierName} - ${options[0].serviceName}` }
          : null,
      };
    }

    case 'SELECT_SHIPPING_OPTION': {
      const opt = state.shippingOptions[action.index];
      if (!opt) return state;
      return {
        ...state,
        selectedShipping: { price: opt.price, label: `${opt.courierName} - ${opt.serviceName}` },
      };
    }

    case 'SET_SHIPPING_STATIC':
      return {
        ...state,
        shippingStatus: 'static',
        shippingOptions: [],
        shippingStaticKm: action.km,
        selectedShipping: { price: action.price, label: action.label },
      };

    case 'SET_SHIPPING_UNAVAILABLE':
      return {
        ...state,
        shippingStatus: 'unavailable',
        shippingOptions: [],
        shippingStaticKm: action.km,
        selectedShipping: null,
      };

    case 'SET_PROFILE':
      return {
        ...state,
        profile: action.profile,
        isProfileFilled: true,
      };

    case 'RESET_PROFILE_CARD':
      return { ...state, isProfileFilled: false, profile: initialState.profile };

    case 'SET_NOTE':
      return { ...state, note: action.note };

    case 'RESET_ORDER':
      // Profile stays — it's the one thing meant to survive past this order
      // (see PROFILE_STORAGE_KEY), so a returning customer doesn't have to
      // retype name/WA/address for their next order in the same visit.
      return {
        ...initialState,
        step: 1,
        profile: state.profile,
        isProfileFilled: state.isProfileFilled,
      };

    default:
      return state;
  }
}

// Profile persists across refresh AND closing the browser entirely (unlike
// cart/step/tanggal, which reset every time) — matches what a returning
// customer expects: name/WA/address/patokan already filled in next visit.
function loadPersistedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return initialState.profile;
    return { ...initialState.profile, ...JSON.parse(raw) };
  } catch {
    return initialState.profile;
  }
}

function loadInitialState() {
  const profile = loadPersistedProfile();
  return {
    ...initialState,
    profile,
    isProfileFilled: Boolean(profile.name && profile.wa),
  };
}

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(state.profile));
    } catch {
      // storage unavailable (private mode, quota) — profile just won't be remembered
    }
  }, [state.profile]);

  return (
    <CartContext.Provider value={{ state, dispatch }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
