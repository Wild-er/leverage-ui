// Constants
const entry_price = 4.0;  // Price of the asset
const order_size = 1.0;   // Number of units bought
const one_way_fee_rate_decisive = 0.0794;  // 7.94%
const roundtrip_fee_rate_decisive = one_way_fee_rate_decisive * 2; // Entry + exit fees = 15.88%
const roundtrip_fee_rate_spot = 0.005;  // 0.5%

function calculate_breakeven_price(leverage) {
    // Breakeven price considers the point at which the position value equals the initial cost plus fees.
    // For a leveraged trade, fees are effectively magnified by leverage in terms of price movement needed.
    // P_be = P_entry * (1 + Total_Fee_Rate / Leverage)
    // Total_Fee_Rate here is roundtrip_fee_rate_decisive
    return entry_price * (1 + roundtrip_fee_rate_decisive / leverage);
}

function calculate_liquidation_price(leverage) {
    // For a long position, liquidation occurs when the price drops enough to wipe out the margin.
    // Margin is entry_price / leverage.
    // Liquidation Price = Entry Price - (Entry Price / Leverage)
    // Liquidation Price = Entry Price * (1 - 1 / Leverage)
    return entry_price * (1 - (1 / leverage));
}

function calculate_spot_pnl_percent(target_price) {
    const profit_or_loss_per_unit = target_price - entry_price;
    const total_initial_cost = entry_price * order_size;
    const total_value_at_target = target_price * order_size;

    // Fees for spot are on the total value transacted, typically on entry and exit.
    // Let's assume fees are paid on the value of the transaction at entry and exit.
    // For simplicity, Python used: (target_price - entry_price) * order_size * (1 - roundtrip_fee_rate_spot)
    // This implies fee is taken from the gross profit.
    // A more standard way: PnL = (Exit_Value - Entry_Value) - Fees
    // Exit_Value_Net = total_value_at_target * (1 - roundtrip_fee_rate_spot_one_way_approx)
    // Entry_Value_Net = total_initial_cost * (1 + roundtrip_fee_rate_spot_one_way_approx)
    // The python script simplifies this to:
    // spot_pnl = (target_price - entry_price) * order_size * (1 - roundtrip_fee_rate_spot);
    // This means (Gross Profit) * (1 - FeeRate)
    // Let's stick to the Python script's calculation method.
    const spot_pnl_gross = (target_price - entry_price) * order_size;
    const spot_fees = (target_price * order_size + entry_price * order_size) * (roundtrip_fee_rate_spot / 2); // Approximation: fee on entry value + fee on exit value
    // The python script's `spot_pnl = (target_price - entry_price) * order_size * (1 - roundtrip_fee_rate_spot)` is simpler.
    // It implies the roundtrip fee is applied on the profit itself, or that (1-fee_rate) is a profit retention factor.
    // Let's use the Python version:
    const spot_pnl = (target_price - entry_price) * order_size * (1 - roundtrip_fee_rate_spot);

    const spot_pnl_percent = (spot_pnl / total_initial_cost) * 100;
    return Math.max(0, spot_pnl_percent); // Clip at 0, assuming no profit if target < breakeven for spot
}

function calculate_leverage_pnl_percent(target_price, leverage) {
    // Notional value of the trade
    const notional_value = entry_price * order_size * leverage;
    
    // Profit or loss based on price movement on the notional value
    const gross_pnl_on_notional = (target_price - entry_price) * order_size * leverage;

    // Fees calculation as per Python script: entry_price * roundtrip_fee_rate_decisive * order_size
    // This means the fee is a fixed amount based on the initial order size at entry price,
    // not directly scaled by the notional leveraged value in its calculation,
    // but it's paid from the proceeds of the leveraged trade.
    const actual_fees = entry_price * order_size * roundtrip_fee_rate_decisive;

    const net_pnl = gross_pnl_on_notional - actual_fees;
    
    // Initial investment (actual capital at risk by the trader)
    const initial_investment = entry_price * order_size; 
    
    const leverage_pnl_percent = (net_pnl / initial_investment) * 100;
    
    // If target price is not met, or if fees outweigh profit, PnL can be negative.
    // The python script clips this at 0 using np.clip(..., a_min=0, a_max=None)
    // For example, if target_price is less than breakeven_price.
    const breakeven = calculate_breakeven_price(leverage);
    if (target_price < breakeven) {
        return 0; // No profit if target is below breakeven
    }
    // Also, ensure liquidation doesn't happen before target
    const liquidation = calculate_liquidation_price(leverage);
    if (target_price <= liquidation && target_price < entry_price) { // relevant for longs
        return 0; // or a large negative number representing loss of margin, but python clips to 0
    }

    return Math.max(0, leverage_pnl_percent); // Clip at 0 as per python's behavior
}

function suggest_trade(target_price_input, timeframe_input) {
    let best_leverage = 0;
    let max_pnl_percent = 0; // Initialize with 0, as we use Math.max(0, pnl)
    let liquidation_at_best_leverage = 0;
    let breakeven_at_best_leverage = 0;

    const leverage_values = [];
    for (let i = 1; i <= 20; i++) { // Corresponds to np.arange(1, 21)
        leverage_values.push(i);
    }

    if (target_price_input <= entry_price) {
        return {
            optimal_leverage: 0,
            potential_pnl_percent: 0,
            liquidation_price_at_optimal_leverage: 0,
            breakeven_price_at_optimal_leverage: 0,
            message: "Target price must be above current entry price ($" + entry_price + ") for a long trade."
        };
    }

    for (const leverage of leverage_values) {
        const current_liquidation_price = calculate_liquidation_price(leverage);
        const current_breakeven_price = calculate_breakeven_price(leverage);

        // Viability for a long trade:
        // 1. Liquidation price must be below the entry price (to avoid immediate liquidation).
        // 2. Target price must be above the breakeven price for the trade to be profitable.
        if (current_liquidation_price < entry_price && target_price_input > current_breakeven_price) {
            const pnl_percent = calculate_leverage_pnl_percent(target_price_input, leverage);

            // Additional check: ensure target is reachable before liquidation
            // For a long, target_price_input should be > current_liquidation_price (which is already < entry_price)
            // This check is implicitly handled if current_liquidation_price < entry_price < target_price_input

            if (pnl_percent > max_pnl_percent) {
                max_pnl_percent = pnl_percent;
                best_leverage = leverage;
                liquidation_at_best_leverage = current_liquidation_price;
                breakeven_at_best_leverage = current_breakeven_price;
            }
        }
    }

    if (best_leverage > 0) {
        return {
            optimal_leverage: best_leverage,
            potential_pnl_percent: parseFloat(max_pnl_percent.toFixed(2)),
            liquidation_price_at_optimal_leverage: parseFloat(liquidation_at_best_leverage.toFixed(2)),
            breakeven_price_at_optimal_leverage: parseFloat(breakeven_at_best_leverage.toFixed(2)),
            message: `Suggested trade for reaching $${target_price_input} (Timeframe: ${timeframe_input} days). Current entry price: $${entry_price}.`
        };
    } else {
        // Construct a more informative message if no suitable leverage is found
        let message = "Could not find a suitable leverage. Reasons could include: ";
        const example_low_leverage_breakeven = calculate_breakeven_price(1);
        if (target_price_input <= example_low_leverage_breakeven) {
            message += `Target price $${target_price_input} is too close to or below the breakeven price (approx. $${example_low_leverage_breakeven.toFixed(2)} even for 1x leverage). `;
        }
        // Check liquidation for a common leverage like 5x if target is reasonable
        if (target_price_input > entry_price) {
             const liq_5x = calculate_liquidation_price(5);
             if (entry_price <= liq_5x) { // This should not happen with correct formula
                 message += "Liquidation prices are too high. ";
             }
        }
        if (message === "Could not find a suitable leverage. Reasons could include: ") {
            message = "Could not find a suitable leverage. Ensure target price is sufficiently above breakeven and considers liquidation risks.";
        }

        return {
            optimal_leverage: 0,
            potential_pnl_percent: 0,
            liquidation_price_at_optimal_leverage: 0,
            breakeven_price_at_optimal_leverage: 0,
            message: message.trim()
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const targetPriceInput = document.getElementById('target-price');
    const timeframeInput = document.getElementById('timeframe');
    const suggestTradeBtn = document.getElementById('suggest-trade-btn');
    const tradeSuggestionDiv = document.getElementById('trade-suggestion');

    suggestTradeBtn.addEventListener('click', () => {
        const targetPrice = parseFloat(targetPriceInput.value);
        const timeframe = parseInt(timeframeInput.value);

        if (isNaN(targetPrice) || isNaN(timeframe)) {
            tradeSuggestionDiv.innerHTML = '<p class="error">Please enter valid numbers for target price and timeframe.</p>';
            return;
        }

        if (timeframe <= 0) {
            tradeSuggestionDiv.innerHTML = '<p class="error">Timeframe must be a positive number of days.</p>';
            return;
        }
        
        // Call the suggest_trade function (defined in the earlier part of script.js)
        const suggestion = suggest_trade(targetPrice, timeframe);

        let suggestionHTML = '';
        if (suggestion.message.includes("must be above current entry price") || suggestion.message.includes("Could not find a suitable leverage")) {
            suggestionHTML = `<p class="error">${suggestion.message}</p>`;
        } else {
            suggestionHTML = `
                <p>
                    ${suggestion.message}<br><br>
                    <strong>Optimal Leverage:</strong> ${suggestion.optimal_leverage}x<br>
                    <strong>Potential PnL (@ $${targetPrice}):</strong> ${suggestion.potential_pnl_percent}%<br>
                    <strong>Liquidation Price:</strong> $${suggestion.liquidation_price_at_optimal_leverage.toFixed(2)}<br>
                    <strong>Breakeven Price (after fees):</strong> $${suggestion.breakeven_price_at_optimal_leverage.toFixed(2)}
                </p>
            `;
        }
        tradeSuggestionDiv.innerHTML = suggestionHTML;
    });
});
