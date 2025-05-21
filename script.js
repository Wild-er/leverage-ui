// Constants
let entry_price = 4.0;  // Price of the asset, will be updated dynamically
const order_size = 1.0;   // Number of units bought
let riskChartInstance = null; // To keep track of the chart
const one_way_fee_rate_decisive = 0.0794;  // 7.94%
const roundtrip_fee_rate_decisive = one_way_fee_rate_decisive * 2; // Entry + exit fees = 15.88%
const roundtrip_fee_rate_spot = 0.005;  // 0.5%
const DAILY_BORROW_FEE_RATE_PLACEHOLDER = 0.001; // Example: 0.1% per day on borrowed amount.

function calculate_d8x_borrow_fees(order_size_units, asset_price, leverage, timeframe_days) {
    if (leverage <= 1) {
        return 0; // No amount is borrowed if leverage is 1x or less.
    }
    const position_value = order_size_units * asset_price;
    // Margin is the trader's own capital in the position
    const margin = position_value / leverage;
    // Borrowed amount is the rest of the position value
    const borrowed_amount = position_value - margin;

    const total_borrow_fee = borrowed_amount * DAILY_BORROW_FEE_RATE_PLACEHOLDER * timeframe_days;
    return total_borrow_fee;
}

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
    
    // entry_price and order_size are global variables/constants
    const profit_before_trading_fees_and_borrow_fees = (target_price - entry_price) * order_size * leverage;
    
    const trading_fees = entry_price * roundtrip_fee_rate_decisive * order_size; 

    // Calculate D8X borrow fees
    // 'entry_price' is used as the asset_price for fee calculation, assuming fees are based on initial borrowed amount.
    const estimated_d8x_borrow_fees = calculate_d8x_borrow_fees(order_size, entry_price, leverage, timeframe_days);

    const final_pnl = profit_before_trading_fees_and_borrow_fees - trading_fees - estimated_d8x_borrow_fees;
    
    // Initial investment (actual capital at risk by the trader)
    const initial_investment = order_size * entry_price; 
    const pnl_percent_after_all_fees = (final_pnl / initial_investment) * 100;
    
    // The old breakeven and liquidation checks for returning 0 are no longer needed here
    // as the PnL can be negative and is handled by the caller (suggest_trade) 
    // for viability decisions.
    // We return the actual PnL percentage.

    return pnl_percent_after_all_fees;
}

function suggest_trade(target_price_input, timeframe_input, risk_level_input) {
    let max_allowed_leverage;
    let min_liquidation_distance_percent; // Percentage of entry price

    if (risk_level_input === 'low') {
        max_allowed_leverage = 7; // Example cap
        min_liquidation_distance_percent = 0.15; // Liquidation must be at least 15% below entry for a long
    } else if (risk_level_input === 'high') {
        max_allowed_leverage = 20; // Higher cap
        min_liquidation_distance_percent = 0.03; // Liquidation can be closer, 3% below entry
    } else { // Medium or default
        max_allowed_leverage = 12; // Example cap
        min_liquidation_distance_percent = 0.08; // 8% below entry
    }

    const leverage_values = [];
    for (let i = 1; i <= max_allowed_leverage; i++) { // Use max_allowed_leverage
        leverage_values.push(i);
    }
    
    let best_leverage = 0;
    let max_pnl_percent = -Infinity; 
    let liquidation_at_best_leverage = 0;
    let breakeven_at_best_leverage = 0; // Stays as breakeven based on trading fees only for now
    let message = ""; 

    if (target_price_input <= entry_price) { 
        message = `Target price $${target_price_input.toFixed(2)} must be above current entry price $${entry_price.toFixed(2)} for a long trade.`;
        return { 
            optimal_leverage: 0, 
            potential_pnl_percent: 0, 
            liquidation_price_at_optimal_leverage: 0, 
            breakeven_price_at_optimal_leverage: 0, 
            message: message 
        };
    }

    for (const leverage of leverage_values) {
        const current_liquidation_price = calculate_liquidation_price(leverage); 
        const required_liquidation_price_threshold = entry_price * (1 - min_liquidation_distance_percent);
        const current_breakeven_price_trading_fees_only = calculate_breakeven_price(leverage); // Used for basic viability

        // Primary Viability Checks:
        // 1. Liquidation price is below the risk-adjusted threshold.
        // 2. Target price is above breakeven (considering only trading fees for now).
        if (current_liquidation_price < required_liquidation_price_threshold && target_price_input > current_breakeven_price_trading_fees_only) {
            const pnl_percent = calculate_leverage_pnl_percent(target_price_input, leverage, timeframe_input);

            if (pnl_percent > max_pnl_percent) {
                max_pnl_percent = pnl_percent;
                best_leverage = leverage;
                liquidation_at_best_leverage = current_liquidation_price;
                breakeven_at_best_leverage = current_breakeven_price_trading_fees_only; // Store this version of breakeven
            }
        }
    }

    if (best_leverage > 0 && max_pnl_percent > -Infinity) { // Check against -Infinity in case all PnLs are negative
        message = `Suggested trade for reaching $${target_price_input.toFixed(2)} (Timeframe: ${timeframe_input} days, Risk: ${risk_level_input}). Assumes current entry price of $${entry_price.toFixed(2)}.`;
        const estimated_fees = calculate_d8x_borrow_fees(order_size, entry_price, best_leverage, timeframe_input);
        return {
            optimal_leverage: best_leverage,
            potential_pnl_percent: parseFloat(max_pnl_percent.toFixed(2)),
            liquidation_price_at_optimal_leverage: parseFloat(liquidation_at_best_leverage.toFixed(2)),
            breakeven_price_at_optimal_leverage: parseFloat(breakeven_at_best_leverage.toFixed(2)), // This is still the one without borrow fees
            estimated_borrow_fees: parseFloat(estimated_fees.toFixed(2)),
            message: message
        };
    } else {
        message = `Could not find a suitable trade for the selected criteria (Target: $${target_price_input.toFixed(2)}, Timeframe: ${timeframe_input} days, Risk: ${risk_level_input}). This might be due to the risk parameters (max leverage ${max_allowed_leverage}x, liquidation distance ${min_liquidation_distance_percent*100}%), target proximity, or fee impact. Consider adjusting inputs or risk level.`;
        return { 
            optimal_leverage: 0, 
            potential_pnl_percent: 0, 
            liquidation_price_at_optimal_leverage: 0, 
            breakeven_price_at_optimal_leverage: 0, 
            message: message 
        };
    }
}

async function fetchBeraPrice() {
    console.log("Fetching Bera price START..."); // Debug line
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    // Simulate a price, e.g., a slight variation or a fixed new price.
    const fetchedPrice = 4.02; 
    console.log("Fetching Bera price ENDED. Price:", fetchedPrice); // Debug line
    return fetchedPrice;
}

function displayRiskCurve(tradeParams, entryPrice, targetPriceInput) {
    const ctx = document.getElementById('riskCurveChart').getContext('2d');

    if (riskChartInstance) {
        riskChartInstance.destroy(); // Destroy previous chart instance
    }

    const { optimal_leverage, liquidation_price_at_optimal_leverage, breakeven_price_at_optimal_leverage, potential_pnl_percent } = tradeParams;

    // Generate data points for the PnL curve
    // We need PnL at various asset prices for a given trade (leverage is fixed here)
    // X-axis: Asset Price, Y-axis: PnL %
    
    const dataPoints = [];
    // Determine a sensible range for asset prices on X-axis
    // Start slightly below liquidation or 0, end slightly above target or breakeven.
    const minX = Math.max(0, liquidation_price_at_optimal_leverage - (entryPrice * 0.1)); // Go 10% of entry below liquidation
    const maxX = Math.max(targetPriceInput, breakeven_price_at_optimal_leverage) + (entryPrice * 0.1); // Go 10% of entry above target/breakeven
    
    const steps = 50; // Number of points to plot for the curve
    for (let i = 0; i <= steps; i++) {
        const currentAssetPrice = minX + (i / steps) * (maxX - minX);
        // Calculate PnL at this currentAssetPrice using the suggested optimal_leverage and original timeframe.
        // We need timeframe here if borrow fees are significant over the curve duration.
        // For simplicity, the PnL on the curve often shows instantaneous PnL at that price,
        // but for this tool, PnL already includes fees over the *user-defined timeframe*.
        // So, we use the existing timeframe from user input.
        const timeframeDays = parseInt(document.getElementById('timeframe').value); // Get current timeframe
        
        const pnlAtThisPricePercent = calculate_leverage_pnl_percent(currentAssetPrice, optimal_leverage, timeframeDays);
        dataPoints.push({ x: currentAssetPrice, y: pnlAtThisPricePercent });
    }
    
    // Data for Chart.js
    const data = {
        datasets: [{
            label: `PnL % (Leverage: ${optimal_leverage}x, Timeframe: ${timeframeDays}d)`,
            data: dataPoints,
            borderColor: 'rgb(75, 192, 192)',
            tension: 0.1,
            fill: false,
            pointRadius: 0 // Hide points for a smoother line
        },
        // Point for Liquidation Price
        {
            label: 'Liquidation Price',
            data: [{ x: liquidation_price_at_optimal_leverage, y: calculate_leverage_pnl_percent(liquidation_price_at_optimal_leverage, optimal_leverage, timeframeDays) }],
            borderColor: 'red',
            backgroundColor: 'red',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: false
        },
        // Point for Breakeven Price
        {
            label: 'Breakeven Price (after all fees)',
            data: [{ x: breakeven_price_at_optimal_leverage, y: 0 }], // PnL is ~0 at breakeven
            borderColor: 'orange',
            backgroundColor: 'orange',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: false
        },
        // Point for Entry Price
        {
            label: 'Entry Price',
            data: [{ x: entryPrice, y: calculate_leverage_pnl_percent(entryPrice, optimal_leverage, timeframeDays) }], // PnL at entry (should be negative due to trading fees & borrow fees for 0 price change)
            borderColor: 'blue',
            backgroundColor: 'blue',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: false
        },
        // Point for Target Price
        {
            label: 'Target Price',
            data: [{ x: targetPriceInput, y: potential_pnl_percent }],
            borderColor: 'green',
            backgroundColor: 'green',
            pointRadius: 5,
            pointHoverRadius: 7,
            showLine: false
        }
        ]
    };

    riskChartInstance = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Asset Price ($)'
                    },
                    ticks: {
                        callback: function(value, index, values) {
                            return '$' + value.toFixed(2);
                        }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'PnL % (incl. all fees over timeframe)'
                    },
                     ticks: {
                        callback: function(value, index, values) {
                            return value.toFixed(2) + '%';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: function(tooltipItems) {
                            return 'Price: $' + tooltipItems[0].parsed.x.toFixed(2);
                        },
                        label: function(tooltipItem) {
                            return `PnL: ${tooltipItem.parsed.y.toFixed(2)}%`;
                        }
                    }
                },
                legend: {
                    position: 'top',
                }
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const currentBeraPriceSpan = document.getElementById('current-bera-price');
    console.log("currentBeraPriceSpan element:", currentBeraPriceSpan); // Debug line
    try {
        const price = await fetchBeraPrice();
        console.log("Fetched price:", price, "Type:", typeof price); // Debug line
        entry_price = price; // Update global entry_price
        console.log("Attempting to set textContent for currentBeraPriceSpan"); // Debug line
        currentBeraPriceSpan.textContent = `$${price.toFixed(2)}`;
        console.log("textContent set to:", currentBeraPriceSpan.textContent); // Debug line
    } catch (error) {
        console.error("Failed to fetch Bera price:", error);
        currentBeraPriceSpan.textContent = "Error loading price";
        // Keep default entry_price or handle error as appropriate
    }

    const targetPriceInput = document.getElementById('target-price');
    const timeframeInput = document.getElementById('timeframe');
    const suggestTradeBtn = document.getElementById('suggest-trade-btn');
    const tradeSuggestionDiv = document.getElementById('trade-suggestion');

    suggestTradeBtn.addEventListener('click', () => {
        const targetPrice = parseFloat(targetPriceInput.value);
        const timeframe = parseInt(timeframeInput.value);

        if (isNaN(targetPrice) || isNaN(timeframe)) {
            tradeSuggestionDiv.innerHTML = '<p class="error">Please enter valid numbers for target price and timeframe.</p>';
            if (riskChartInstance) { riskChartInstance.destroy(); riskChartInstance = null; } // Clear chart
            return;
        }

        if (timeframe <= 0) {
            tradeSuggestionDiv.innerHTML = '<p class="error">Timeframe must be a positive number of days.</p>';
            if (riskChartInstance) { riskChartInstance.destroy(); riskChartInstance = null; } // Clear chart
            return;
        }
        
        // Call the suggest_trade function (defined in the earlier part of script.js)
        const selected_risk_level = document.querySelector('input[name="risk-level"]:checked').value;
        const suggestion = suggest_trade(targetPrice, timeframe, selected_risk_level);

        let suggestionHTML = '';
        if (suggestion.optimal_leverage && suggestion.optimal_leverage > 0) {
            suggestionHTML = `
                <p>
                    ${suggestion.message}<br><br>
                    <strong>Optimal Leverage:</strong> ${suggestion.optimal_leverage}x<br>
                    <strong>Potential PnL (@ $${targetPrice.toFixed(2)}):</strong> ${suggestion.potential_pnl_percent}%<br>
                    <strong>Estimated D8X Borrow Fees (over ${timeframe} days):</strong> $${suggestion.estimated_borrow_fees.toFixed(2)}<br>
                    <strong>Liquidation Price:</strong> $${suggestion.liquidation_price_at_optimal_leverage.toFixed(2)}<br>
                    <strong>Breakeven Price (after fees):</strong> $${suggestion.breakeven_price_at_optimal_leverage.toFixed(2)}
                </p>
            `;
            // Display the chart if a valid trade is suggested
            // entry_price is the global variable updated by fetchBeraPrice
            // targetPrice is from targetPriceInput.value
            displayRiskCurve(suggestion, entry_price, targetPrice);
        } else {
            // Error or no trade message handling
            suggestionHTML = `<p class="error">${suggestion.message}</p>`;
            if (riskChartInstance) { // Clear chart if no valid suggestion or error
                riskChartInstance.destroy();
                riskChartInstance = null;
            }
        }
        tradeSuggestionDiv.innerHTML = suggestionHTML;
    });
});
