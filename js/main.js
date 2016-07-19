$(document).ready(function(){

	var original;
    $("#logo.subpage").mouseover(function(){
    	original= $(this).attr('src');
        $(this).attr('src','img/adn_animated_croped.png');
    }); 
    $("#logo.subpage").mouseout(function(){
        $(this).attr('src',original);
    });

    const BIN_PATH = {
        Firefox: "https://addons.mozilla.org/firefox/addon/adnauseam/",
        Chrome: "https://chrome.google.com/webstore/detail/adnauseam/hgfacieeomogkcchookiodlpppbcolha",
        Opera: "https://addons.opera.com/extensions/details/adnauseam-2/"
    }

    var binPath = BIN_PATH[bowser.name];
    
    // when it's not Firefox, Chrome or Opera
    if (binPath == undefined) {
        $("div#install").find("a").find("text").attr("x", "35");
        $("div#install").find("a").find("text").text("Try it on Chrome, Firefox or Opera!");
    }
    else {
        $("div#install").find("a").attr("xlink:href", binPath);
    }
});