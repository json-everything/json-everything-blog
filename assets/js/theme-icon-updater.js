/**
 * Update theme toggle icon based on current mode
 */
(function() {
  const $toggleElem = $('.mode-toggle');
  
  function updateModeIcon() {
    const $icon = $toggleElem.find('i');
    const $tooltip = $toggleElem.find('.tooltip-text');
    const htmlMode = $('html').attr('data-mode');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Determine if we're in dark mode
    const isDark = htmlMode === 'dark' || (!htmlMode && systemPrefersDark);
    
    // Update icon: outline for dark mode, solid for light mode
    const newIcon = isDark ? 'lightbulb_outline' : 'lightbulb';
    $icon.text(newIcon);
    
    // Update tooltip text
    const tooltipText = isDark ? 'Turn the lights on' : 'Turn the lights off';
    $tooltip.text(tooltipText);
  }
  
  if ($toggleElem.length > 0) {
    // Update icon on page load
    $(document).ready(function() {
      updateModeIcon();
    });
    
    // Listen for mode changes via window messages
    window.addEventListener('message', function(event) {
      if (event.data && event.data.direction === 'mode-toggle') {
        updateModeIcon();
      }
    });
    
    // Also listen for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
      updateModeIcon();
    });
    
    // Update icon after click
    $toggleElem.on('click', function() {
      setTimeout(updateModeIcon, 10);
    });
  }
})();
